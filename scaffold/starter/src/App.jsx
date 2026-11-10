export default function App() {
  return (
    <main className="page">
      <p className="eyebrow">BuilderHarness prototype</p>
      <h1>从一个真实页面开始。</h1>
      <p className="lede">
        把产品界面放在这里。开发时打开顶部的「评论」，点选页面元素即可留下批注。
      </p>
      <section className="card">
        <h2>下一步</h2>
        <ol>
          <li>在 <code>docs/features/</code> 下创建第一个 FRS</li>
          <li>在 <code>src/config/frs-map.js</code> 里登记对应的路由</li>
        </ol>
      </section>
    </main>
  );
}
