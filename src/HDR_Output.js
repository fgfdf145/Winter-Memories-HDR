//=============================================================================
// HDR_Output.js
//-----------------------------------------------------------------------------
// 1) Compatibility fixes so this RPG Maker MV 1.6.1 game runs on modern NW.js.
// 2) HDR output: every rendered frame of the game canvas is copied into a
//    WebGPU canvas (rgba16float, extended tone mapping) and highlights are
//    expanded above SDR white. Needs Windows "Use HDR" to be on.
//
// Hotkeys (saved between sessions):
//   Ctrl+H   toggle HDR on/off (off = identical to original SDR image)
//   Ctrl+]   raise highlight peak
//   Ctrl+[   lower highlight peak
//=============================================================================

(function () {
    'use strict';

    //-------------------------------------------------------------------------
    // Settings (defaults; Ctrl+H / Ctrl+[ / Ctrl+] changes are remembered)
    //-------------------------------------------------------------------------
    var DEFAULTS = {
        enabled: true,
        peak: 2.5,            // brightest white = peak x Windows SDR white level
        paperWhite: 1.0,      // gain for midtones/shadows (1.0 = same as SDR)
        highlightStart: 0.6,  // linear luminance where highlight expansion starts
        saturation: 1.05      // colour saturation in HDR mode (1.0 = unchanged)
    };
    var PEAK_MIN = 1.0, PEAK_MAX = 6.0, PEAK_STEP = 0.25;
    var STORAGE_KEY = 'HDR_Output_Settings';

    //-------------------------------------------------------------------------
    // NW.js compatibility: process.mainModule is not set on modern NW.js when
    // the app entry is an HTML file, which breaks the save directory path.
    //-------------------------------------------------------------------------
    (function fixMainModule() {
        if (typeof require !== 'function' || typeof process !== 'object') return;
        var path = require('path');
        var fs = require('fs');
        var candidates = [];
        try {
            if (window.location.protocol === 'file:') {
                var p = decodeURIComponent(window.location.pathname);
                if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
                candidates.push(path.normalize(p));
            }
        } catch (e) {}
        try {
            if (typeof nw !== 'undefined' && nw.__dirname) {
                var main = (nw.App && nw.App.manifest && nw.App.manifest.main) || 'index.html';
                candidates.push(path.join(nw.__dirname, main.split(/[?#]/)[0]));
            }
        } catch (e) {}
        candidates.push(path.join(process.cwd(), 'www', 'index.html'));

        var target = null;
        for (var i = 0; i < candidates.length; i++) {
            if (fs.existsSync(candidates[i])) { target = candidates[i]; break; }
        }
        if (!target) return;

        var current = null;
        try { current = process.mainModule && process.mainModule.filename; } catch (e) {}
        if (!current || path.dirname(current).toLowerCase() !== path.dirname(target).toLowerCase()) {
            try {
                Object.defineProperty(process, 'mainModule', {
                    value: { filename: target }, configurable: true, writable: true
                });
            } catch (e) {
                try { process.mainModule = { filename: target }; } catch (e2) {}
            }
        }

        var saveDir = path.join(path.dirname(target), 'save/');
        StorageManager.localFileDirectoryPath = function () {
            return saveDir;
        };
    })();

    //-------------------------------------------------------------------------
    // Settings persistence
    //-------------------------------------------------------------------------
    var settings = Object.assign({}, DEFAULTS);
    try {
        var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (stored) {
            if (typeof stored.enabled === 'boolean') settings.enabled = stored.enabled;
            if (typeof stored.peak === 'number') settings.peak = stored.peak;
        }
    } catch (e) {}

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                enabled: settings.enabled, peak: settings.peak
            }));
        } catch (e) {}
    }

    var hdrQuery = window.matchMedia ? window.matchMedia('(dynamic-range: high)') : null;

    function displayIsHdr() {
        return !hdrQuery || hdrQuery.matches;
    }

    //-------------------------------------------------------------------------
    // WebGPU HDR presenter
    //-------------------------------------------------------------------------
    var SHADER = [
        'struct Params { peak: f32, paper: f32, start: f32, sat: f32, on: f32, p0: f32, p1: f32, p2: f32 };',
        '@group(0) @binding(0) var src: texture_2d<f32>;',
        '@group(0) @binding(1) var<uniform> P: Params;',
        '',
        '@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {',
        '    var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));',
        '    return vec4f(p[i], 0.0, 1.0);',
        '}',
        '',
        'fn toLinear(c: vec3f) -> vec3f {',
        '    return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));',
        '}',
        '',
        '// Extended sRGB encoding: values above 1.0 are brighter than SDR white.',
        'fn toSrgb(c: vec3f) -> vec3f {',
        '    let a = max(c, vec3f(0.0));',
        '    return select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a <= vec3f(0.0031308));',
        '}',
        '',
        '@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {',
        '    let s = textureLoad(src, vec2i(pos.xy), 0);',
        '    if (P.on < 0.5) {',
        '        return vec4f(s.rgb, 1.0);',
        '    }',
        '    var lin = toLinear(s.rgb);',
        '    let y = dot(lin, vec3f(0.2126, 0.7152, 0.0722));',
        '    lin = max(mix(vec3f(y), lin, P.sat), vec3f(0.0));',
        '    let t = clamp((y - P.start) / max(1.0 - P.start, 0.0001), 0.0, 1.0);',
        '    let g = t * t * (3.0 - 2.0 * t);',
        '    let gain = mix(P.paper, P.peak, g);',
        '    return vec4f(toSrgb(lin * gain), 1.0);',
        '}'
    ].join('\n');

    var HDR = {
        ready: false,
        shown: false,
        failed: false,
        error: null,
        device: null,
        context: null,
        canvas: null,
        pipeline: null,
        uniformBuffer: null,
        texture: null,
        bindGroup: null,
        texWidth: 0,
        texHeight: 0,
        cssText: null,
        uniformsDirty: true,
        frames: 0
    };

    function initHdr() {
        if (!navigator.gpu) {
            fail(new Error('WebGPU is not available'));
            return;
        }
        navigator.gpu.requestAdapter().then(function (adapter) {
            if (!adapter) throw new Error('No WebGPU adapter');
            return adapter.requestDevice();
        }).then(setupDevice).catch(fail);
    }

    function setupDevice(device) {
        HDR.device = device;
        device.lost.then(function (info) {
            if (HDR.device !== device || info.reason === 'destroyed') return;
            console.warn('HDR_Output: GPU device lost (' + info.message + '), retrying');
            teardown();
            setTimeout(initHdr, 1000);
        });

        var canvas = document.createElement('canvas');
        canvas.id = 'HdrCanvas';
        canvas.width = Graphics._canvas.width;
        canvas.height = Graphics._canvas.height;
        var context = canvas.getContext('webgpu');
        context.configure({
            device: device,
            format: 'rgba16float',
            colorSpace: 'srgb',
            toneMapping: { mode: 'extended' },
            alphaMode: 'opaque'
        });

        var module = device.createShaderModule({ code: SHADER });
        HDR.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: module, entryPoint: 'vs' },
            fragment: { module: module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' }
        });
        HDR.uniformBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        HDR.canvas = canvas;
        HDR.context = context;
        HDR.texWidth = HDR.texHeight = 0;
        HDR.cssText = null;
        HDR.uniformsDirty = true;
        HDR.failed = false;
        HDR.error = null;
        HDR.ready = true;
    }

    function makeTexture(width, height) {
        if (HDR.texture) HDR.texture.destroy();
        HDR.texture = HDR.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
                   GPUTextureUsage.RENDER_ATTACHMENT
        });
        HDR.bindGroup = HDR.device.createBindGroup({
            layout: HDR.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: HDR.texture.createView() },
                { binding: 1, resource: { buffer: HDR.uniformBuffer } }
            ]
        });
        HDR.texWidth = width;
        HDR.texHeight = height;
    }

    function writeUniforms() {
        var on = settings.enabled && displayIsHdr();
        HDR.device.queue.writeBuffer(HDR.uniformBuffer, 0, new Float32Array([
            settings.peak, settings.paperWhite, settings.highlightStart, settings.saturation,
            on ? 1 : 0, 0, 0, 0
        ]));
        HDR.uniformsDirty = false;
    }

    // Mirror size, position, opacity and filter of the game canvas.
    function syncCanvas(src) {
        var canvas = HDR.canvas;
        if (canvas.width !== src.width) canvas.width = src.width;
        if (canvas.height !== src.height) canvas.height = src.height;
        if (HDR.cssText !== src.style.cssText) {
            canvas.style.cssText = src.style.cssText;
            canvas.style.visibility = 'visible';
            canvas.style.pointerEvents = 'none';
            HDR.cssText = src.style.cssText;
        }
    }

    function present() {
        var src = Graphics._canvas;
        if (!HDR.ready || !src || !src.width || !src.height) return;
        try {
            if (!HDR.canvas.parentNode) {
                src.parentNode.insertBefore(HDR.canvas, src.nextSibling);
            }
            syncCanvas(src);
            if (HDR.texWidth !== src.width || HDR.texHeight !== src.height) {
                makeTexture(src.width, src.height);
            }
            if (HDR.uniformsDirty) writeUniforms();

            var device = HDR.device;
            device.queue.copyExternalImageToTexture(
                { source: src },
                { texture: HDR.texture, colorSpace: 'srgb' },
                [src.width, src.height]
            );
            var encoder = device.createCommandEncoder();
            var pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: HDR.context.getCurrentTexture().createView(),
                    clearValue: [0, 0, 0, 1],
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            pass.setPipeline(HDR.pipeline);
            pass.setBindGroup(0, HDR.bindGroup);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
            HDR.frames++;

            if (!HDR.shown) {
                HDR.shown = true;
                src.style.visibility = 'hidden';
            }
        } catch (e) {
            fail(e);
        }
    }

    function teardown() {
        HDR.ready = false;
        HDR.shown = false;
        if (HDR.canvas && HDR.canvas.parentNode) {
            HDR.canvas.parentNode.removeChild(HDR.canvas);
        }
        if (Graphics._canvas) {
            Graphics._canvas.style.visibility = '';
        }
        if (HDR.texture) {
            try { HDR.texture.destroy(); } catch (e) {}
        }
        var device = HDR.device;
        HDR.device = HDR.context = HDR.canvas = HDR.texture = HDR.bindGroup = null;
        HDR.texWidth = HDR.texHeight = 0;
        if (device) {
            try { device.destroy(); } catch (e) {}
        }
    }

    function fail(e) {
        console.error('HDR_Output: falling back to SDR -', e);
        HDR.failed = true;
        HDR.error = String(e && e.message || e);
        teardown();
    }

    //-------------------------------------------------------------------------
    // Hook into the engine after all plugins have been set up
    //-------------------------------------------------------------------------
    var _SceneManager_initGraphics = SceneManager.initGraphics;
    SceneManager.initGraphics = function () {
        _SceneManager_initGraphics.apply(this, arguments);
        if (!Graphics._canvas || !Graphics._renderer) return;

        var _Graphics_render = Graphics.render;
        Graphics.render = function (stage) {
            _Graphics_render.apply(this, arguments);
            if (this._rendered && stage) {
                present();
            }
        };
        initHdr();
    };

    if (hdrQuery) {
        var onDisplayChange = function () { HDR.uniformsDirty = true; };
        if (hdrQuery.addEventListener) {
            hdrQuery.addEventListener('change', onDisplayChange);
        } else if (hdrQuery.addListener) {
            hdrQuery.addListener(onDisplayChange);
        }
    }

    //-------------------------------------------------------------------------
    // Hotkeys and on-screen status
    //-------------------------------------------------------------------------
    var osdElement = null;
    var osdTimer = 0;

    function statusText() {
        var text = 'HDR ' + (settings.enabled ? 'ON' : 'OFF') +
                   '  |  peak ' + settings.peak.toFixed(2) + 'x';
        if (!HDR.ready) {
            text += '  |  unavailable: ' + (HDR.error || 'starting');
        } else if (!displayIsHdr()) {
            text += '  |  Windows HDR is off';
        }
        return text;
    }

    function showOsd(text) {
        if (!osdElement) {
            osdElement = document.createElement('div');
            osdElement.id = 'HdrStatus';
            osdElement.style.cssText =
                'position:fixed;left:8px;top:8px;z-index:100;padding:4px 10px;' +
                'font:14px monospace;color:#fff;background:rgba(0,0,0,0.65);' +
                'border-radius:4px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(osdElement);
        }
        osdElement.textContent = text;
        osdElement.style.opacity = '1';
        clearTimeout(osdTimer);
        osdTimer = setTimeout(function () { osdElement.style.opacity = '0'; }, 1800);
    }

    document.addEventListener('keydown', function (event) {
        if (!event.ctrlKey || event.altKey || event.shiftKey) return;
        switch (event.code) {
        case 'KeyH':
            settings.enabled = !settings.enabled;
            break;
        case 'BracketRight':
            settings.peak = Math.min(PEAK_MAX, settings.peak + PEAK_STEP);
            break;
        case 'BracketLeft':
            settings.peak = Math.max(PEAK_MIN, settings.peak - PEAK_STEP);
            break;
        default:
            return;
        }
        event.preventDefault();
        HDR.uniformsDirty = true;
        saveSettings();
        showOsd(statusText());
    });

    window.HDR_Output = { state: HDR, settings: settings, status: statusText };
})();
