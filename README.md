# Winter Memories HDR

[中文](#中文) · [English](#english)

## 中文

给 Steam 版《冬日狂想曲 / Winter Memories》（RPG Maker MV 1.6.1）加上真正的 HDR 输出。

仓库里只有 mod 本身：插件、安装脚本和卸载脚本。不包含任何游戏文件，也不包含 NW.js 二进制（安装时从 NW.js 官网下载）。

### 原理

1. **更换运行时**：游戏自带的 NW.js 0.29（Chromium 65）无法输出 HDR，安装脚本会把它换成 NW.js v0.115.0（Chromium 152）。
2. **HDR 输出**（`src/HDR_Output.js`）：PIXI 每渲染完一帧，就把游戏画布复制到一张 WebGPU 画布上。这张画布使用 `rgba16float` 格式，并开启 `toneMapping: extended`，数值可以超过 SDR 白。
   - 中间调和暗部保持原样。
   - 高光在 `highlightStart` 以上平滑提亮，最亮处达到 Windows SDR 白的 `peak` 倍。
   - 画布的尺寸、位置、透明度、滤镜都跟随原游戏画布，所以视频播放、错误画面这类由引擎控制的效果照常工作。
   - WebGPU 不可用或出错时，自动退回原来的 SDR 画面。
3. **兼容修复**：
   - 新版 NW.js 下 `process.mainModule` 失效，会导致存档路径错误，插件里修复了。
   - `package.json` 补上应用名（新版 NW.js 要求不能为空）。
   - 允许音频自动播放。

### 要求

- Windows 10 / 11，HDR 显示器，并在"设置 → 显示"里打开**使用 HDR**
- 支持 WebGPU 的显卡驱动
- 安装时需要联网（约 200 MB）

### 安装

先关闭游戏，然后双击 `install.cmd`。

游戏不在默认的 Steam 路径时，可以手动指定：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -GameDir "D:\SteamLibrary\steamapps\common\Winter Memories"
```

| 参数 | 说明 |
| --- | --- |
| `-GameDir` | 游戏目录，默认 `C:\Program Files (x86)\Steam\steamapps\common\Winter Memories` |
| `-NwjsVersion` | 要安装的 NW.js 版本，默认 `v0.115.0` |
| `-NwjsZip` | 使用已经下载好的 `nwjs-<版本>-win-x64.zip`（仍会校验 SHA-256） |
| `-UpdateRuntime` | 即使已经装了新版运行时，也强制重新替换 |

脚本依次做这些事：

1. 首次安装时，把原运行时、`www/index.html`、`www/package.json`、`www/js`、`www/save` 备份到游戏目录下的 `_backup_nwjs0.29`。
2. 下载 NW.js 并校验 SHA-256，然后替换运行时（`nw.exe` 改名为 `Game.exe`）。
3. 把 `HDR_Output.js` 复制到 `www/js`，并在 `index.html` 里加载它。
4. 修改 `package.json`。

脚本可以重复运行。以后更新插件，再跑一次 `install.cmd` 即可，不会重复下载运行时。

如果提示没有写入权限，用管理员身份运行。

### 快捷键

设置会自动保存。

| 按键 | 作用 |
| --- | --- |
| `Ctrl+H` | 开关 HDR（关掉后和原版画面完全一样） |
| `Ctrl+]` | 提高高光亮度（最高 6x） |
| `Ctrl+[` | 降低高光亮度（最低 1x） |

按下后左上角会显示当前状态。如果 Windows 没开 HDR 或者 WebGPU 不可用，这里也会提示。

### 调整默认参数

编辑 `src/HDR_Output.js` 开头的 `DEFAULTS`，然后重新运行 `install.cmd`：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `peak` | `2.5` | 最亮处 = Windows SDR 白 × peak |
| `paperWhite` | `1.0` | 中间调和暗部的亮度倍率 |
| `highlightStart` | `0.6` | 从这个线性亮度开始提亮高光 |
| `saturation` | `1.05` | HDR 模式下的饱和度 |

### 卸载

先关闭游戏，然后双击 `uninstall.cmd`。它会从 `_backup_nwjs0.29` 恢复原运行时、`index.html`、`package.json`，并删除 `HDR_Output.js`。

- 存档不会被覆盖，安装之后的游戏进度都会保留。
- 想连备份一起删掉，加上 `-RemoveBackup`。

### 注意事项

- Steam 的"验证游戏文件完整性"或游戏更新会还原运行时和 `index.html`，之后重新运行 `install.cmd` 即可。
- 白色文字也会一起变亮，觉得刺眼就按 `Ctrl+[` 调低。
- 过场视频不经过 HDR 处理，保持 SDR 亮度。
- 替换运行时后，`Game.exe` 的图标会变成 NW.js 默认图标。

### 文件

| 文件 | 说明 |
| --- | --- |
| `src/HDR_Output.js` | HDR 输出插件和兼容修复 |
| `install.ps1` / `install.cmd` | 安装 |
| `uninstall.ps1` / `uninstall.cmd` | 卸载 |

## English

Adds real HDR output to the Steam version of *Winter Memories* (冬日狂想曲, RPG Maker MV 1.6.1).

This repository contains only the mod itself: the plugin and the install and uninstall scripts. It includes no game files and no NW.js binaries; the installer downloads NW.js from the official site.

### How it works

1. **Runtime upgrade**: The game ships with NW.js 0.29 (Chromium 65), which cannot output HDR. The installer replaces it with NW.js v0.115.0 (Chromium 152).
2. **HDR output** (`src/HDR_Output.js`): After PIXI renders each frame, the game canvas is copied onto a WebGPU canvas. That canvas uses the `rgba16float` format with `toneMapping: extended`, so its values can go above SDR white.
   - Midtones and shadows are left unchanged.
   - Highlights above `highlightStart` are smoothly brightened, up to `peak` times the Windows SDR white level.
   - The canvas follows the game canvas's size, position, opacity and filters, so engine-controlled effects such as video playback and the error screen keep working.
   - If WebGPU is unavailable or fails, the game falls back to its original SDR image.
3. **Compatibility fixes**:
   - `process.mainModule` no longer works on newer NW.js, which breaks the save path. The plugin fixes this.
   - `package.json` gets an app name, since newer NW.js does not allow it to be empty.
   - Audio autoplay is allowed.

### Requirements

- Windows 10 / 11, an HDR display, and **Use HDR** turned on under Settings → Display
- A graphics driver with WebGPU support
- An internet connection during installation (about 200 MB)

### Installation

Close the game, then double-click `install.cmd`.

If the game is not in the default Steam location, pass its folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -GameDir "D:\SteamLibrary\steamapps\common\Winter Memories"
```

| Parameter | Description |
| --- | --- |
| `-GameDir` | Game folder. Default: `C:\Program Files (x86)\Steam\steamapps\common\Winter Memories` |
| `-NwjsVersion` | NW.js version to install. Default: `v0.115.0` |
| `-NwjsZip` | Use an already downloaded `nwjs-<version>-win-x64.zip` (its SHA-256 is still checked) |
| `-UpdateRuntime` | Replace the runtime even if a newer one is already installed |

The script does the following:

1. On the first install, it backs up the original runtime, `www/index.html`, `www/package.json`, `www/js` and `www/save` to `_backup_nwjs0.29` inside the game folder.
2. It downloads NW.js, checks its SHA-256, and replaces the runtime (`nw.exe` is renamed to `Game.exe`).
3. It copies `HDR_Output.js` to `www/js` and loads it from `index.html`.
4. It updates `package.json`.

The script is safe to run more than once. To update the plugin later, just run `install.cmd` again; the runtime is not downloaded a second time.

If you get a permission error, run it as administrator.

### Hotkeys

Settings are saved automatically.

| Key | Action |
| --- | --- |
| `Ctrl+H` | Turn HDR on or off (off looks exactly like the original game) |
| `Ctrl+]` | Raise highlight brightness (up to 6x) |
| `Ctrl+[` | Lower highlight brightness (down to 1x) |

After each key press, the current status appears in the top-left corner. It also tells you if Windows HDR is off or WebGPU is unavailable.

### Changing the defaults

Edit `DEFAULTS` at the top of `src/HDR_Output.js`, then run `install.cmd` again:

| Setting | Default | Description |
| --- | --- | --- |
| `peak` | `2.5` | Brightest white = Windows SDR white × peak |
| `paperWhite` | `1.0` | Brightness multiplier for midtones and shadows |
| `highlightStart` | `0.6` | Linear luminance where highlight brightening starts |
| `saturation` | `1.05` | Color saturation in HDR mode |

### Uninstallation

Close the game, then double-click `uninstall.cmd`. It restores the original runtime, `index.html` and `package.json` from `_backup_nwjs0.29` and deletes `HDR_Output.js`.

- Save files are not overwritten, so any progress made after installing is kept.
- Add `-RemoveBackup` to delete the backup as well.

### Notes

- Steam's "Verify integrity of game files" and game updates restore the original runtime and `index.html`. Run `install.cmd` again afterwards.
- White text gets brighter too. If it is too bright, press `Ctrl+[`.
- Cutscene videos are not HDR-processed and stay at SDR brightness.
- After the runtime is replaced, `Game.exe` shows the default NW.js icon.

### Files

| File | Description |
| --- | --- |
| `src/HDR_Output.js` | HDR output plugin and compatibility fixes |
| `install.ps1` / `install.cmd` | Install |
| `uninstall.ps1` / `uninstall.cmd` | Uninstall |
