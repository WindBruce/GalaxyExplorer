# Galaxy Explorer —— 架构

一款 3D 银河探索 / 考古 RPG。整个游戏从一个静态目录运行：没有构建步骤，没有打包器，
除了内置的一份 Three.js 之外没有任何运行时依赖。本文档描述代码如何组织、为什么这样
组织，以及它如何扩展。

```
npm start     # http://localhost:8080
npm test      # 69 个无头测试（模拟、内容、界面、渲染、通关）
npm run check # 对每个源文件执行 node --check
```

---

## 1. 分层

```
index.html            DOM 外壳：画布 + HUD + 面板 + 弹窗 + 地图浮层 + 菜单
styles.css            完整的界面皮肤
src/main.js           入口：new Game() -> await game.boot() + 致命错误浮层
        |
src/Game.js           总控：渲染器、摄像机、输入、状态机、主循环、
        |             快捷键、自动存档、bus -> UI 连接
        +-------------------+--------------------+-------------------+
        |                   |                    |
   src/states/         src/render/          src/ui/
   StateMachine        Shaders (GLSL)       Notifications (通知条)
   SpaceState          Objects (工厂)       HUD
   SurfaceState        Input                Panels (9 个面板)
   MapState            FlightControls      Modals (对话/事件/空间站/贸易)
   (银河地图)           SpaceScene           GalacticMapUI
                       TerrainScene         MainMenu
                       GalaxyMapScene
        |
src/sim/              src/world/           src/core/
ShipSystem            StarSystemGenerator  Random (带种子的 PRNG，Rng 类)
ResourceSystem        GalaxyGenerator      EventBus (+ 全局 `bus`)
SkillSystem           NameGen              Time (GameClock)
TechSystem                                DataLoader (data/*.json)
ArchiveSystem                             SaveSystem (localStorage + JSON 导出)
ArchaeologySystem                         Noise (fbm / ridged，CPU)
CivilizationSystem
QuestSystem
EventSystem
FTLSystem
CombatSystem
GameState
```

**依赖规则：** `core` 不依赖任何层，`world` 依赖 `core`，`sim` 依赖 `core`+`world`，
`render` 依赖 `core`+`sim`+`world`+Three，`states` 依赖 `render`+`sim`+`ui`，`ui` 依赖
`sim`+`core`，`Game` 依赖所有层。`core`、`sim` 与 `world` 中的任何代码都不接触 DOM，
这正是模拟部分能在 Node 中被测试的原因（见 §7）。

---

## 2. 确定性

每一次随机抽取都来自 `src/core/Random.js` 中的 `Rng(seed)`——一个 mulberry32 风格的
生成器，带有游戏需要的辅助方法（`float`、`int`、`chance`、`pick`、`weighted`、`range`）。
种子来源如下：

| 内容 | 种子来源 |
| --- | --- |
| 银河布局 | 玩家种子字符串（默认为 `MilkyWay-4471`） |
| 恒星系统细节 | `hash(systemId) ^ galaxySeed` |
| 行星地形 | `hash(planetId)` |
| 名称 | `hash(galaxySeed + nameIndex)` |
| 事件 | `hash(galaxySeed ^ stardate ^ context)` |
| 遗物分析 | `hash(artifactId)` |
| 敌对目标 / 残骸 | `hash(galaxySeed ^ hostileId)` |

设计所依赖的几个推论：

* 存档文件只保存种子、发现标志位与玩家状态——银河本身在读档时被**确定性地重新生成**
  （`GameState.deserialize` 会调用 `createGalaxy(save.galaxy.seed, …)` 然后重放发现
  过程）。因此存档极小（约 7 kB），且不会因内容更新而失步。
* 测试可以断言精确的结果（`tests/test_simulation.mjs`）。

---

## 3. 数据驱动的内容

所有内容都存放在 `data/*.json`，由 `DataLoader.loadAllData()` 加载，它会同时剔除文档
用键（`_comment` 等）并归一化包装结构。模拟代码中不硬编码任何文明、行星类型、资源、
任务、科技、技能、遗物或事件。

| 文件 | 内容 |
| --- | --- |
| `regions.json` | 9 个银河星区（核心 → 未知区域），含系统数、配色、危险度、文明偏向 |
| `resources.json` | 19 种资源：等级、分类、基础价格、波动率、用途 |
| `shipModules.json` | 14 个槽位共 57 个模块，各含 `cost`、`stats`、`requiresTech`、`mass`、`powerDraw` |
| `technologies.json` | 10 个分类共 55 项科技，含受遗物解锁的 `unknown` 分类 |
| `skills.json` | 8 个职业分支共 41 个技能节点，含 `statMods` / `flat` / `bonuses` |
| `civilizations.json` | 4 个现存文明（对话树、经济、政治）+ 5 个已灭绝文明 |
| `species.json` | 每个文明的物种档案 |
| `artifacts.json` | 26 件遗物：等级、文明标签、纪元、`supports`（时间线事件）、`techTag` |
| `quests.json` | 12 个任务，含目标图与任务链 |
| `timeline.json` | 8 个纪元、8 个剧本事件，以及 6 阶段的主线谜团（`m0`–`m5`） |
| `events.json` | 14 个动态叙事事件，含加权、上下文受控的选项 |

新增一种遗迹类型、文明或任务只需要改 JSON，最多再加一条标签映射——不需要改动引擎。
如果某个内容包引用了不存在的 id（悬空的对话节点、未知的科技前置、没有对应科技的遗物
标签、指向缺失任务的任务链……），`tests/test_content.mjs` 会让构建失败。

### 国际化

`src/core/I18n.js` 是一个零依赖、可感知 DOM 的字典。仓库中内置两种语言，加入第三种只需
改数据：

```
data/i18n/en.json          界面字符串，键 -> 英文文本
data/i18n/zh.json          相同的键 -> 中文文本
data/i18n/content/zh.json  内容包的叙述文本 -> 中文文本
```

`DataLoader.loadI18nPacks()` 会先合并 `i18n/<locale>`，再合并 `i18n/content/<locale>`，
得到一个扁平映射，因此 `en` 直接回退到已编写的数据包，只有 `zh` 需要内容覆盖层。

| 调用 | 用途 |
| --- | --- |
| `t(key, vars)` | 界面字符串，`{name}` 插值，未知时返回键本身 |
| `tp(key, count, vars)` | 复数感知的变体（`key.one` / `key.other`） |
| `content(kind, id, fallback, field)` | 数据记录的叙述文本：优先取翻译，否则取内容包自身文本 |
| `reason(result)` | 本地化一条带有 `reasonKey` / `reasonVars` 的模拟失败结果 |
| `setLocale(id)` | 切换语言、持久化到 `localStorage`、重渲染文档、发出 `i18n:changed` |
| `applyToDocument()` | 重写每个 `data-i18n`、`data-i18n-attr`、`data-i18n-html` 与 `data-i18n-vars` 节点 |

未知键返回键本身而不是抛异常，因此缺口会在界面中可见，而不是让游戏崩溃。
`Game._onLocaleChanged()` 会重新应用文档，然后重新打开屏幕上原本打开的面板、弹窗或地图，
让整个界面一次性切换。由种子生成的模拟叙述文本（`StarSystemGenerator`、`describeLife`、
`describeRuin`）在生成时读取语言设置，且从不扰动随机数，因此银河在两种语言下完全一致。

`tests/test_i18n.mjs` 强制保证这一契约：各语言之间键一一对应、代码请求的键都存在、
字典中没有失效的键，并且每个内容包中的每个 id（包括程序化生成的文案表）都有中文翻译。

### 语音与音频设置

`src/ui/Settings.js` 负责该浮层（`F2`）。语言、主音量 / 音乐 / 音效 / 环境音量、是否
语音播报、音色选择与语速都持久化到 `localStorage['galaxyexplorer.settings']`。播报只有
一个出口：`Notifications.onSpeak` -> `Settings.speak()` -> `speechSynthesis`，而
`Game.narrate(text)` 是通讯内容、分析报告与任务结算的唯一调用点。当播报关闭（或浏览器
没有语音引擎）时 `speak()` 是空操作，游戏依然完全可玩。

### 派生的飞船属性

`ShipSystem.recompute()` 从已安装模块、技能修正与科技能力重新计算出每一项属性。模块数据
使用紧凑的属性名，这些名字会在不同槽位之间冲突（扫描仪的 `range` 与武器的 `range`，
护盾的 `regen` 与装甲的 `regen`），因此 `SLOT_STAT_ALIAS` 按槽位分别解析。功率消耗以
功率输出为预算，过载时会使护盾与推力断电。

---

## 4. 扩展到数百万个系统的银河

切片内置约 1,100 个已命名系统，但没有任何东西把银河预先生成为一个扁平的全细节系统
数组：

* `Galaxy` 只保存**系统描述符**（id、名称、星区、位置、恒星类型、种子、标志位）。
  完整的行星 / 卫星 / 遗迹 / 空间站细节由 `StarSystemGenerator` 在首次进入该系统时惰性
  生成（`galaxy.getSystem(id)` → `ensureDetailed`）。
* 位置由种子按对数螺旋臂生成，因此距离查询（`distanceLy`、`systemsWithinLy`）只需
  描述符即可工作。
* 银河地图把描述符云渲染为单个 `Points` 对象，按星区逐点着色——整个银河一次绘制调用，
  拾取使用 `Raycaster.params.Points.threshold` 并以 `distanceToRay` 作为平局判定。
* 同样的结构可以扩展到数百万个系统：描述符约 200 字节，因此百万系统的银河约 200 MB
  描述符（或配合 `serialize` 已在使用的"星区 + 序号"方案只需几 MB）。引擎中没有任何
  部分假设系统数量很小。

燃料经济正是按这个尺度调校的：原装驱动器可达约 2,200 光年（邻近五个系统），二级约
6,000 光年，三级约 18,000 光年，反物质驱动器约 38,000 光年，而回收的共鸣之门约
60,000 光年——主线谜团的锚点系统距家园 58,120 光年，即一段终局旅程。

---

## 5. 模拟

`GameState` 是唯一的事实来源：玩家、飞船、位置、研究、标志位、属性，以及每个领域一个
子系统。子系统之间互不 import；它们通过 `state` 和全局 `bus`（`src/core/EventBus.js`）
通信。

值得注意的契约：

* `state.shipSystem.stats` —— 派生属性，仅在 `recompute()` 之后有效。
* `state.resources` —— 受货舱限制的资源账本（`amount/add/remove/spend/canAfford/price/
  buy/sell/mine/manifest/used/capacity`）。
* `state.ship.applyDamage(amount, type)` —— 委托给 `ShipSystem`，因此战斗、地表危险
  与事件效果共用同一条伤害路径。
* `state.archaeology` —— 证据模型（见 `docs/design.md` §5）：收集 → 分析 →
  假设 / 确证，受 `analysis` / `translation` 属性限制。
* `state.ftl.canJump(from, to)` —— 关于航程、燃料与充能时间的唯一权威；地图、飞行
  HUD 与任务系统都向它查询。

总线承载约 30 个事件（`resource:gained`、`tech:researched`、`artifact:analyzed`、
`civ:politics`、`ship:destroyed`、`travel:complete` 等）。`Game._wireBus()` 把它们转化为
通知；界面从不轮询模拟。

---

## 5.1 状态机契约

`StateMachine.change(name, payload, force)`：

* **场景惰性创建。** `Game` 在构造函数中构造各状态，*早于* `boot()` 创建 `GameState`
  的时刻——因此 `SpaceState` 与 `SurfaceState` 在 `enter()` 中通过 `_ensureScene()` 构建
  自己的 `SpaceScene` / `TerrainScene`，当 `GameState` 对象被替换时（新游戏 / 读档）也会
  重建。在构造时捕获 `game.state` 正是
  `Cannot read properties of null (reading 'update')` 崩溃的原因：`enter()` 抛异常，
  随后每一帧都在驱动一个 `controls` 从未被赋值的状态。
* **`force` 会重新进入当前状态。** 读档会改变当前状态所处的世界，因此 `loadGame()`
  传入 `force = true`。
* **重新进入同一状态会跳过 `exit()`。** 它的 `enter()` 会重建场景；之后再退出会把刚建好
  的东西释放掉。
* **`payload` 在缺省时归一化为 `undefined`**，从而让状态默认值（`enter(payload = {})`）
  生效——传入 `null` 会在 `payload.planet` 上让 `SurfaceState.enter` 崩溃。
* **失败的 `enter()` 被限制在局部。** 错误只记录一次，状态机保持（或恢复到）先前状态，
  而不是每帧驱动一个半初始化状态。各状态的 `update()` 也有
  `if (!state || !this.scene || !this.controls) return;` 的保护。

## 6. 渲染

* Three.js r0.160.1 内置在 `vendor/three.module.js`，以相对说明符引入——游戏离线可用，
  无需 CDN，也无需打包器。
* `Shaders.js` 存放所有 GLSL 片段（程序化恒星表面，含米粒组织与耀斑；行星地形按高度 /
  坡度着色；大气边缘散射；吸积盘；星云体积；扫描脉冲；引擎喷流）。
* `Objects.js` 的工厂返回 `Group` / `Mesh` 对象，并在 `userData` 中打上标签（`kind`、
  `radius` 等），于是场景图同时充当实体列表。场景（`SpaceScene`、`TerrainScene`、
  `GalaxyMapScene`）只负责组合工厂。
* 两套控制装置：`FlightControls`（类 6DOF，含惯性漂移、加速、刹车、第一 / 第三人称）与
  `CharacterControls`（行走 / 疾跑 / 跳跃、地面贴合、第一 / 第三人称）。两者都是纯 CPU
  代码，并有单元测试。
* 状态机决定哪个场景图挂到渲染器上；渲染主循环位于 `Game._tick`，主菜单打开时暂停。

## 7. 测试

| 套件 | 证明了什么 |
| --- | --- |
| `tests/test_simulation.mjs` | 17 个测试：银河确定性、系统多样性、新游戏不变量、模块属性与门槛、货舱上限、技能、研究、遗物分析 → 证据 → 谜团阶段、任务、文明声望 / 对话 / 市场、事件、战斗、跃迁、存档往返 |
| `tests/test_content.mjs` | 12 个测试：每个相对 import 都能解析、JS 引用的每个 DOM id 都存在于 `index.html`、所有内容包格式良好、内容中无悬空引用 |
| `tests/test_ui.mjs` | 11 个测试：jsdom 驱动真实的 HUD、全部九个面板、对话、事件、空间站 / 贸易、分析、银河地图与主菜单 |
| `tests/test_scenes.mjs` | 5 个测试：真实 Three.js 场景构建、动画循环、控制器、对象工厂 |
| `tests/test_boot.mjs` | 6 个测试：仅替换 `WebGLRenderer`（`tests/helpers/three-stub.mjs`，通过 `node --import ./tests/helpers/register.mjs` 安装）来构造真实的 `Game`，并驱动 启动 → 新游戏 → 飞行 → 存档 / 读档 → 刷新页面继续 → 地表恢复 → 受控的 `enter()` 失败 |
| `tests/test_playthrough.mjs` + `tests/test_gameplay.mjs` | 9 个测试：飞行 → 锁定 → 扫描 → 地图 → 跃迁 → 降落 → 发掘 → 采矿 → 战斗 → 对接 → 存档 / 读档，全部通过真实状态机 |

依赖 DOM 的套件需要 jsdom；若未安装它们会自行跳过，因此 `npm test` 在裸检出的环境中
依然保持绿色。`tests/helpers/dom.mjs` 把 jsdom 安装为 Node 全局变量（不含
`performance`，其 jsdom 实现在 Node 下会无限递归）。

开发过程中这套测试环境抓到的 bug（均已修复）：`src/render` 与 `src/states` 中内置
Three.js 的相对路径层级错误、一个泄漏进科技表的 `_comment` 键、缺失的 `makeBolt` 导入
（第一发即崩溃）、被槽位别名表丢弃的武器射速属性、战斗 / 危险 / 事件伤害调用了不存在
的 `state.ship.applyDamage`、一个让银河无法抵达的跃迁航程、把飞船压制在自身 `maxSpeed`
之下的飞行阻尼、永远无法进入武器射程的敌对目标，以及 §5.1 中的状态机 bug（状态在
`GameState` 存在之前就被构建、状态机退出它刚刚重新进入的状态、`null` payload 让
`SurfaceState.enter` 崩溃、失败的 `enter()` 每帧被驱动）。

## 8. 持久化

`SaveSystem` 在 `localStorage` 中保存四个存档位（`autosave`、`slot1`–`slot3`），另有
JSON 导出 / 导入用于在不同机器间迁移存档。一切都经由
`GameState.serialize()` / `deserialize()`；`SaveSystem.peek/allSlots/remove` 为主菜单
提供支持。自动存档每 120 秒执行一次。

## 9. 约定

* 全部使用 ES 模块、具名导出，不使用默认导出。
* 2 空格缩进、单引号、分号；`node --check` 保持干净。
* 注释解释*为什么*；公开方法写 JSDoc。
* 新的游戏内容 → 先 JSON，后引擎。
* 任何新的跨模块调用点都必须体现在某个测试中。