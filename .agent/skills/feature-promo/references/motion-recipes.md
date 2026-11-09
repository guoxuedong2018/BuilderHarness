# 简单品牌动效配方

这些效果不需要 3D、粒子或外部素材，用 CSS/SVG + 时间函数就能做。所有动画都写成 `t` 的纯函数；不要用 `Date.now()`、`Math.random()` 或 CSS `transition` 驱动画面状态。

## 0. 时间工具

```js
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const progress = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fade = (t, in0, in1, out0 = Infinity, out1 = Infinity) =>
  Math.min(progress(t, in0, in1), 1 - progress(t, out0, out1));
```

## 1. 品牌渐变球

用途：Agent、智能、连接、结果。不要把它当纯装饰铺满屏。

```html
<div class="orb" id="orb"></div>
<style>
.orb {
  position: absolute;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  filter: blur(1px) saturate(1.05);
  background:
    radial-gradient(circle at 32% 28%, #59d7ff 0 16%, transparent 40%),
    radial-gradient(circle at 72% 30%, #ff5f8f 0 18%, transparent 44%),
    radial-gradient(circle at 48% 76%, #ffc24b 0 22%, transparent 48%),
    linear-gradient(135deg, #6a5cff, #ff7a45);
  box-shadow: 0 30px 80px rgba(255, 122, 69, .22);
  will-change: transform, opacity;
}
</style>
<script>
function renderOrb(t) {
  const o = fade(t, 0.6, 1.4, 7.2, 8.0);
  const drift = Math.sin(t * 0.7) * 8;
  const scale = 0.92 + 0.08 * easeOut(progress(t, 0.6, 2.0));
  orb.style.opacity = o;
  orb.style.transform = `translate(-50%, calc(-50% + ${drift}px)) scale(${scale})`;
}
</script>
```

规则：

- 一屏最多一个主球；小球可以 3–5 个，但只做背景层次。
- 颜色从品牌色取；不要默认紫蓝渐变。
- 漂浮周期 8–12 秒，幅度 ≤12px；不要旋转。
- 球和产品 UI 同屏时，球只占 10–20% 画面。

## 2. 动态字卡

用途：Hook、价值句、章节标题。

```html
<div class="title" id="title">
  <span class="line"><i>发布前，</i></span>
  <span class="line"><i>先看见偏差。</i></span>
</div>
<style>
.title { position: absolute; left: 96px; top: 96px; font: 600 72px/1.08 Inter, "PingFang SC", sans-serif; color: #171717; }
.title .line { display: block; overflow: hidden; }
.title i { display: block; font-style: normal; transform: translateY(110%); }
</style>
<script>
function renderTitle(t) {
  const lines = [...title.querySelectorAll("i")];
  lines.forEach((el, i) => {
    const p = easeOut(progress(t, 0.2 + i * 0.12, 0.8 + i * 0.12));
    el.style.transform = `translateY(${(1 - p) * 110}%)`;
  });
  title.style.opacity = fade(t, 0, 0.2, 3.8, 4.3);
}
</script>
```

规则：

- 一行一个意思；最多两行。
- 不要逐字弹跳、不要彩虹字、不要描边。
- 标题进入 0.4–0.6 秒；落定后停 ≥1.2 秒。
- 标题和产品 UI 同屏时，标题只占左上或左下，不压住核心界面。

## 3. 指标数字

用途：证明结果，但数字必须有出处。

```html
<div class="metric" id="metric">
  <b id="metricValue">0</b>
  <span>条反馈已定位到源码</span>
</div>
<style>
.metric { position: absolute; left: 96px; bottom: 96px; color: #171717; }
.metric b { font: 600 96px/1 Inter, sans-serif; font-variant-numeric: tabular-nums; }
.metric span { display: block; margin-top: 8px; font-size: 24px; color: #6b6b6b; }
</style>
<script>
const TARGET = 128;
function renderMetric(t) {
  const p = easeOut(progress(t, 1.0, 2.2));
  metricValue.textContent = Math.round(TARGET * p);
  metric.style.opacity = fade(t, 0.8, 1.0, 5.0, 5.4);
}
</script>
```

规则：

- 只滚真实数字；没有数据就用“一个界面/一次点击”这种可验证事实。
- 数字和标签同一左边界；小数点对齐。
- 不要把“100%”“10x”当装饰；没有测量就不要写。

## 4. UI 卡片堆叠

用途：展示多个能力，但最后只留一个主角。

```html
<div class="stack" id="stack">
  <div class="card">需求</div>
  <div class="card">页面</div>
  <div class="card">源码</div>
</div>
<style>
.stack { position: absolute; right: 96px; top: 50%; width: 360px; height: 300px; transform: translateY(-50%); }
.card { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 24px; background: #fff;
  box-shadow: 0 24px 60px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.06); font: 600 32px/1 Inter, sans-serif; }
</style>
<script>
const cards = [...stack.querySelectorAll(".card")];
function renderStack(t) {
  cards.forEach((card, i) => {
    const p = easeOut(progress(t, 0.8 + i * 0.16, 1.4 + i * 0.16));
    const settle = i === cards.length - 1 ? 1 : 1 - i * 0.04;
    card.style.opacity = p;
    card.style.transform = `translate(${(1 - p) * 40 + i * 18}px, ${(1 - p) * 24 + i * 14}px) rotate(${i * 3 - 3}deg) scale(${settle})`;
  });
}
</script>
```

规则：

- 最多 3 张；最后一张是主角。
- 卡片进入后停住，不要持续漂浮。
- 卡片内容用产品真实模块名，不用“强大/智能/高效”。

## 5. Logo 墙

用途：信任背书。没有授权 Logo 就不要做。

```html
<div class="logos" id="logos">
  <div>ACME</div><div>NORTH</div><div>VERTEX</div>
  <div>LUMEN</div><div>ORBIT</div><div>FIELD</div>
</div>
<style>
.logos { position: absolute; inset: 160px 120px; display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: #e8e6e1; border: 1px solid #e8e6e1; }
.logos div { display: grid; place-items: center; background: #faf9f6; color: #777; font: 600 24px/1 Inter, sans-serif; }
</style>
<script>
const logos = [...document.querySelectorAll(".logos div")];
function renderLogos(t) {
  logos.forEach((el, i) => {
    const p = easeOut(progress(t, 0.8 + i * 0.05, 1.2 + i * 0.05));
    el.style.opacity = p;
    el.style.transform = `translateY(${(1 - p) * 8}px)`;
  });
}
</script>
```

规则：

- 灰度；不要拉伸、加阴影、加描边。
- 每个 Logo 停留可读；不要 0.1 秒闪完。
- 没有授权就用抽象客户类型，不要编造品牌。

## 6. 擦除对比

用途：旧流程 vs 新流程，少一步/快一步。

```html
<div class="compare">
  <img class="old" src="old.png" alt="">
  <div class="new-wrap" id="newWrap"><img src="new.png" alt=""></div>
  <div class="wipe" id="wipe"></div>
</div>
<style>
.compare { position: absolute; inset: 96px; overflow: hidden; border-radius: 24px; }
.compare img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.new-wrap { position: absolute; inset: 0; clip-path: inset(0 100% 0 0); }
.wipe { position: absolute; top: 0; bottom: 0; width: 2px; background: #171717; left: 0; }
</style>
<script>
function renderCompare(t) {
  const p = easeInOut(progress(t, 1.2, 2.4));
  newWrap.style.clipPath = `inset(0 ${100 - p * 100}% 0 0)`;
  wipe.style.left = `${p * 100}%`;
}
</script>
```

规则：

- 两张图同视口、同滚动位置、同尺寸。
- 旧画面必须是真实旧版/线上截图，不能凭记忆画。
- 竖线移动 0.8 秒，停住后再讲解。

## 7. 聚光灯

用途：在复杂界面里只强调一个目标。

```html
<div class="spot" id="spot"></div>
<style>
.spot { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at var(--x) var(--y), transparent 0 120px, rgba(0,0,0,.45) 121px); }
</style>
<script>
function renderSpot(t, x, y) {
  spot.style.setProperty("--x", `${x}px`);
  spot.style.setProperty("--y", `${y}px`);
  spot.style.opacity = fade(t, 1.2, 1.6, 4.8, 5.2);
}
</script>
```

规则：

- 一个镜头只给一个主角。
- 不要又推近又压暗；二选一。
- 压暗比例 35–50%，不要全黑。

## 8. 结尾卡

用途：品牌记忆 + 一个 CTA。

```html
<div class="end" id="end">
  <div class="mark">V7</div>
  <p>把重复工作交给 Agent。</p>
  <span>v7labs.com</span>
</div>
<style>
.end { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; background: #f7f6f2; }
.end .mark { font: 700 64px/1 Inter, sans-serif; letter-spacing: -.04em; }
.end p { margin: 24px 0 12px; font: 500 32px/1.3 Inter, "PingFang SC", sans-serif; color: #333; }
.end span { font-size: 20px; color: #777; }
</style>
<script>
function renderEnd(t) {
  const p = easeOut(progress(t, 0.2, 0.8));
  end.style.opacity = p;
  end.style.transform = `translateY(${(1 - p) * 12}px)`;
}
</script>
```

规则：

- 只留产品名 + 一句价值 + 一个 CTA。
- 停 2.5 秒以上；不要在结尾堆功能列表。
- 二维码、地址、版权放配文，不放进画面。

## 9. 背景网格

用途：给白色画面一点结构，不要喧宾夺主。

```css
.stage {
  background-color: #f7f6f2;
  background-image:
    linear-gradient(rgba(0,0,0,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,.035) 1px, transparent 1px);
  background-size: 48px 48px;
  background-position: -1px -1px;
}
```

规则：

- 线宽 1px，透明度 ≤4%；产品 UI 出现时降低或去掉。
- 不要用大面积渐变、噪点、光晕；GIF 会出色带/体积暴涨。

## 10. 组合建议

一支 30 秒片最多用：

- 1 个 Hook 动效（字卡或结果画面）
- 2 个镜头运动（推近 + 平移）
- 1 个品牌符号（渐变球/Logo 墙/产品色块）
- 1 个证据动效（数字/擦除/聚光）
- 1 个结尾卡

超过这个数量，就会从“高级”变成“特效展示”。
