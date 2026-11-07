# 口嗨万智牌

一个 Windows 上的万智牌局面重演工具。导入 Endstep 回放，或用文字描述局面，再尝试另一种打法。模型把想法整理成动作，Forge 校验费用、目标和结算，输出可在 Endstep 播放的 .esreplay。

## 下载与使用

下载 Kouhai-MTG-Setup-x64.exe。支持带 Microsoft Edge 的 Windows 10/11 x64。安装包包含 Node.js、Java、Forge 和本地牌表库，可离线安装。 [GitHub Releases](https://github.com/zixuanyu038-lang/Kouhai-MTG/releases)

1. 选择导入回放或从描述创建局面。
2. 上传双方牌表、使用本地库，或在 Codex 模式中主动选择联网检索。
3. 选择 Codex 或兼容 API，描述要执行的打法。可配置本机兼容模型服务。
4. 检查 Forge 的结果，导出回放。在描述模式下也可以逐回合编辑战报，并从已校验的节点开分支。

[完整使用教程](使用教程.md) · [功能与构建文档](replay-converter/README.md) · [Endstep 本地回放](https://endstep.cc/replay/local)

## 源码与构建

| 路径 | 内容 |
| --- | --- |
| replay-converter/ | 应用界面、本地服务、模型接入和战报编辑 |
| replay-converter/windows/ | Windows 启动器、离线安装包构建和安装脚本 |
| endstep-reader/ | 共享的局面恢复、牌表、Forge 接口和回放生成代码 |
| endstep-reader/data/ | 内置赛事牌表快照和来源 |

在 Windows 上安装 Node.js 22 或更高版本。在仓库根目录运行以下命令来准备 Forge 并启动服务。

    powershell -ExecutionPolicy Bypass -File endstep-reader/forge/setup.ps1
    node replay-converter/server.js

在浏览器打开终端输出的本机地址。使用 node replay-converter/smoke.cjs 可跑本地集成测试。完整的离线安装包构建命令及固定版本见 [构建文档](replay-converter/README.md#开发)。

## 许可证

项目源码采用 [GPL-3.0-only](LICENSE)。随安装包分发的 Node.js、Temurin 和 Forge 各自保留上游许可证及源码来源，见 [第三方组件说明](replay-converter/windows/THIRD-PARTY.txt)。本地牌表快照来源和 MIT 许可见 [牌表库说明](endstep-reader/data/README.md) 和 [上游许可](endstep-reader/data/LICENSE-MODOMETA.md)。
