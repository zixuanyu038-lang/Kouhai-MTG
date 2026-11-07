# 口嗨万智牌

从描述创建万智牌局面，或把 Endstep 原局中的一个操作改成你想打的路线。选起点、核对牌表、写打法，由模型提炼目标，Forge 执行规则和双方后续。

## 安装

运行 `Kouhai-MTG-Setup-x64.exe`，填写安装位置或点击「浏览…」选择文件夹。核对显示的最终目录后点击「安装」。升级默认沿用已登记的安装目录，也可勾选创建桌面快捷方式。安装包内置 Node.js、Java、Forge 规则及本地牌表库，首次安装可离线完成。安装完成后选择「打开应用」，以后可从 Windows 开始菜单打开「口嗨万智牌」。适用于带 Microsoft Edge 的 Windows 10/11 x64。

关闭窗口后，本机服务留在 Windows 任务栏托盘。从开始菜单或托盘可重新打开窗口。升级或卸载前，先从托盘退出应用。原「战报重演」可直接升级，已保存的起点和草稿会继续使用。

Forge 推演、牌表本地检索和回放文件生成在本机完成。自然语言整理需要模型。可以连接已登录的 Codex、远程兼容 API，或在「OpenAI 兼容 API」中填入本机模型服务的回环地址（如 `http://127.0.0.1:1234/v1`）和模型 ID。牌表联网检索由用户主动选择。密钥只在本次窗口使用。 [OpenAI Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

## 使用

1. 选择「从描述创建」或「导入回放」。描述局面时，写下阶段和优先权、双方生命、战场、手牌、坟场、放逐区，以及会影响操作的库顶、堆叠、法术力和本回合历史。
2. 选择牌表来源。描述模式默认生成练习牌表，也可选本地检索、Codex 联网检索或上传英文 `.txt` / `.dec` 牌表。本地检索使用附带的 Legacy 赛事库。描述里可写明手牌总数、已知牌和双方能量，未知手牌由后端按牌表补齐。点击「整理并核对局面」，查看牌表、补齐的手牌和采用的假设。修改描述或牌表后需重新整理。
3. 写下你想执行的打法。回放模式可补充原局场面，并逐行指定对手未知手牌中的完整英文牌名。描述模式可直接在起点描述中指定双方已知手牌或库顶。其余未知手牌和牌库顺序按固定牌表与种子填补。
4. 点击「开始推演」。Forge 执行成功后下载 `.esreplay`，到 Endstep 的本地回放页打开。结果会标出已到终局或只完成了预算内的片段。 [Endstep 本地回放](https://endstep.cc/replay/local)

一次重演只续演所选局。导入模式保留原局之前的记录，描述模式从核对后的局面开始。后续由 Forge 的策略决定，牌表与手牌假设记录在回放中。编译前核对起点、合法动作和目标完成情况。描述起点限双人对局、己方优先权，支持维持、抓牌、主阶段和结束步骤。涉及战斗中、附着、衍生物等尚不能忠实恢复的起点时，页面会指出限制。

描述模式也可逐段编辑战报：

1. 整理起始局面后，在时间轴点击「新建节点」，只填写这一步的动作或要核对的结果。可以记录双方动作，例如「己方起动 Wasteland，目标是对手的 Hedge Maze」和「双方让过并结算，确认 Hedge Maze 在对手坟场」。
2. 用「新建回合」划分时间轴。可填写到新回合前的动作，或勾选「允许 Forge 补演到下一回合」。回放会标记补演部分。引擎沿用起点的固定牌表和未知牌假设。
3. 点「检查战报」。页面定位到第一个非法或与预期不符的节点，并保留后续描述。修改前文后，可重新检查受影响的节点。
4. 所有节点通过后，点「导出战报」生成截至最后一个节点的回放。也可以选中一个经核对且仍在进行的节点，填写另一种打法，再点「从所选节点推演」。

起点和草稿保存在本机。重开软件后可继续修改，节点需要重新校验。当前可用文字指定施放、下地、起动、让过和推进，战斗中的攻击与阻挡由 Forge 决定。

接口兼容只代表能够发送请求。模型仍可能理解错时机、牌名或目标。可在「核对理解与实际执行」查看模型的复述和 Forge 的动作。起点动作必须在选定的优先权执行。失败时页面会标出连接、牌表、起点、打法提炼、规则执行或回放编译阶段，并显示具体原因。

## 开发

在仓库根目录执行 `node replay-converter/server.js` 可启动开发服务。构建安装包需要预先准备官方 Windows x64 Node.js 24.22.1 的 `node.exe` 和同版 `LICENSE`、Temurin 17.0.20.1+1 的 `jdk.zip`、Forge 2.0.15 的 `forge-2.0.15.tar.bz2`。Studio 的 Forge 准备脚本可取得后两项，默认放在 `%LOCALAPPDATA%\EndstepForgeProbe`。构建脚本校验二进制输入，离线生成精简 Java 运行镜像，并将所需文件打进安装包。 [Node.js 发布](https://nodejs.org/dist/v24.22.1/) · [Temurin 发布](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1) · [Forge 发布](https://github.com/Card-Forge/forge/releases/tag/forge-2.0.15)

```powershell
powershell -ExecutionPolicy Bypass -File replay-converter/windows/build.ps1 -NodeExe C:\build-inputs\node.exe -NodeLicense C:\build-inputs\LICENSE
```

构建输出默认放在 `output/`。通过 `-RuntimeSource` 可指定两个归档所在的目录。

`node replay-converter/smoke.cjs` 使用本机 Forge、合成对局和兼容 API 替身做端到端测试。共享的规则接口、恢复和回放编译源文件在 `endstep-reader/`。
