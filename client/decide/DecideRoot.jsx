import { useEffect } from "react";
import { useSnapshot } from "valtio";

import { Btn, Icon, cx } from "../core/ui";
import { DecisionCard } from "./DecisionCard";
import { RefPanel } from "./RefPanel";
import { copyText, decideState, followHash, init, itemsOf, openFeature, openFromOverview, openItem, openOverview, overviewOf, plain, refresh, setAuthor } from "./store";
import "./Decide.less";

const GROUP_LABEL = { A: "你拍板", B: "问研发", C: "问业务", D: "评审会" };
const SHORT = { pending: "待定", submitted: "已提交", decided: "已定", provisional: "暂留", "needs-review": "待复核" };
/**
 * 返回原型：从工具栏打开的带着 ?from=#/<原型路由>，回到那一页；README 直达链接打开的没有来处，回原型首页。
 * 只认 #/ 开头的原型路由，地址栏里塞别的不跟
 */
const backHref = (() => {
  const from = new URLSearchParams(window.location.search).get("from") || "";
  return from.startsWith("#/") ? "/" + from : from.startsWith("/") && !from.startsWith("//") && !from.includes("\\") ? from : "/";
})();

/** 件套的短名：标题冒号前那一截（「评测集数据分布」），全称在悬停里 */
const shortTitle = (t) => String(t ?? "").split(/[：:]/)[0];

function Toast() {
  const { notice } = useSnapshot(decideState);
  return (
    <div className="dc-toast-dock" role="status" aria-live="polite">
      {notice && (
        <div key={notice.id} className={cx("dc-toast", `is-${notice.kind}`)}>
          {notice.text}
        </div>
      )}
    </div>
  );
}

/** 一份件套的清单：按组排，每组写还有几条待定、几条 ⛔ 没定 */
function ItemList({ feature, active }) {
  return feature.groups.map((g) => {
    const pending = g.items.filter((it) => it.status === "pending").length;
    const blocking = g.items.filter((it) => it.blocking && it.status !== "decided").length;
    return (
      <section key={g.letter} className="dc-group" aria-labelledby={`dc-g-${g.letter}`}>
        <div className="dc-group-head">
          <h2 id={`dc-g-${g.letter}`}>
            {g.letter} · {GROUP_LABEL[g.letter]}
          </h2>
          <span className="dc-group-counts">
            {pending ? `待定 ${pending}` : "没有待定"}
            {blocking > 0 && <em title="定稿前必须有答案、还没定的">⛔ {blocking}</em>}
          </span>
        </div>
        <ul>
          {g.items.map((it) => (
            <li key={it.id}>
              <button type="button" className={cx("dc-row", it.id === active && "is-active")} aria-current={it.id === active ? "true" : undefined} onClick={() => openItem(it.id)}>
                <span className="dc-row-id">{it.id}</span>
                {it.blocking && (
                  <span className="dc-row-block" title="定稿前必须有答案">
                    ⛔
                  </span>
                )}
                <span className="dc-row-q">{plain(it.question)}</span>
                <span className={cx("dc-row-status", `is-${it.status}`)}>{SHORT[it.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  });
}

/** 一组的全部问题，按件套分段，开会前一次带上。⛔ 排在每段前面；编号就是 README 里那一条，问回来好对号 */
function copyGroup(g, features) {
  const segs = features
    .map((f) => ({ title: f.title, items: g.items.filter((it) => it.key === f.key).sort((a, b) => b.blocking - a.blocking || a.k - b.k) }))
    .filter((seg) => seg.items.length > 0);
  const text = segs
    .map((seg) => [`【${seg.title}】`, ...seg.items.map((it) => `${it.id}. ${plain(it.question)}${it.why ? `\n    为什么问：${plain(it.why)}` : ""}`)].join("\n"))
    .join("\n\n");
  copyText(text, `已复制 ${g.items.length} 条问题（${segs.length} 份需求）`);
}

/**
 * 全部件套：各份还没定的条目（待定、暂留待确认）按谁来定汇在一起，开会前把要问研发、要问业务的一次带上。
 * 点一条，右边打开的是所属那份的那张卡，和单看那份时同一张
 */
function OverviewList({ features, activeKey, active }) {
  return overviewOf(features).map((g) => {
    const blocking = g.items.filter((it) => it.blocking).length;
    return (
      <section key={g.letter} className="dc-group" aria-labelledby={`dc-o-${g.letter}`}>
        <div className="dc-group-head">
          <h2 id={`dc-o-${g.letter}`}>{g.label}</h2>
          <span className="dc-group-counts">
            {g.items.length ? `${g.items.length} 条` : "都定了"}
            {blocking > 0 && <em title="定稿前必须有答案">⛔ {blocking}</em>}
          </span>
          {(g.letter === "B" || g.letter === "C") && g.items.length > 0 && (
            <Btn size="sm" className="dc-group-copy" title="按需求分段复制，带「为什么问」，开会时一次问完" onClick={() => copyGroup(g, features)}>
              复制全部问题
            </Btn>
          )}
        </div>
        <ul>
          {g.items.map((it) => {
            const on = it.key === activeKey && it.id === active;
            return (
              <li key={`${it.key}#${it.id}`}>
                <button type="button" className={cx("dc-row", "is-two", on && "is-active")} aria-current={on ? "true" : undefined} onClick={() => openFromOverview(it.key, it.id)}>
                  <span className="dc-row-meta">
                    <span className="dc-row-feat" title={it.title}>
                      {shortTitle(it.title)}
                    </span>
                    <span className="dc-row-id">{it.id}</span>
                    {it.blocking && (
                      <span className="dc-row-block" title="定稿前必须有答案">
                        ⛔
                      </span>
                    )}
                    <span className={cx("dc-row-status", `is-${it.status}`)}>{SHORT[it.status]}</span>
                  </span>
                  <span className="dc-row-q">{plain(it.question)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  });
}

/**
 * 决策页 —— 套件的独立页面，不挂原型（工具栏的「决策」新窗口打开）。
 *
 * 各需求件套 README 的〈待决清单〉摆成「左边清单、右边一张卡」：A 组拍板，B / C 记问到的结果，D 记会上的结论。
 * 左栏最上面是「全部件套」：几份需求还没定的条目按谁来定汇在一起；下拉里选一份就只看那份。
 * 页面只是输入口：决定落进批注收件箱，Agent 记进 README；卡上的结论与状态永远从 README 现读。
 */
export function DecideRoot() {
  const snap = useSnapshot(decideState);
  const { feature, features, overview } = snap;
  const item = itemsOf(feature).find((it) => it.id === snap.active);
  const open = features.reduce((n, f) => n + (f.open?.length ?? 0), 0);
  const openBlocking = features.reduce((n, f) => n + (f.open ?? []).filter((it) => it.blocking).length, 0);

  useEffect(() => {
    init();
    // 在编辑器里改了 README、在对话里让 Agent 记完，回到这页就是新的
    const onBack = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("hashchange", followHash);
    return () => {
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("hashchange", followHash);
    };
  }, []);

  useEffect(() => {
    document.querySelector(".dc-main")?.scrollTo({ top: 0 });
  }, [snap.key, snap.active]);

  const c = feature?.counts;
  return (
    <div className="dc-page">
      <header className="dc-bar">
        <a className="dc-back" href={backHref} title="回到原型（打开决策页之前在看的那一页）">
          <Icon name="back" size={12} />
          返回原型
        </a>
        <span className="dc-brand">决策</span>
        {features.length > 0 && (
          <label className="dc-feat">
            <span className="dc-sr">看哪份需求</span>
            <select className="dc-input" value={overview ? "" : (snap.key ?? "")} onChange={(e) => (e.target.value ? openFeature(e.target.value) : openOverview())}>
              <option value="">{`全部件套 · 还没定 ${open}`}</option>
              {features.map((f) => (
                <option key={f.key} value={f.key}>
                  {`${f.title} · 待定 ${f.counts.pending}${f.counts.blocking ? ` · ⛔ ${f.counts.blocking}` : ""}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {feature && !overview && (
          <code className="dc-path" title="待决清单的真源：页面只读它，结论由 Agent 写回这里">
            {feature.file}
          </code>
        )}
        <div className="dc-bar-right">
          <label className="dc-author">确认人
            <input className="dc-input" defaultValue={snap.author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          {overview ? (
            <span className="dc-tally">
              {features.length} 份需求 · 还没定 {open}
              {openBlocking > 0 && ` · ⛔ ${openBlocking}`}
            </span>
          ) : (
            c && (
              <span className="dc-tally">
                待定 {c.pending}
                {c.provisional > 0 && ` · 暂留待确认 ${c.provisional}`}
                {c.submitted > 0 && ` · 已提交待记录 ${c.submitted}`} · 已定 {c.decided}
              </span>
            )
          )}
          <Btn kind="ghost" title="改了 README 之后重新读一遍" onClick={refresh}>
            重新读取
          </Btn>
        </div>
      </header>

      {snap.loading ? (
        <div className="dc-blank">读取中…</div>
      ) : snap.error ? (
        <div className="dc-blank">
          <p>{snap.error}</p>
          <Btn onClick={refresh}>重试</Btn>
        </div>
      ) : features.length === 0 ? (
        <div className="dc-blank">
          <p>还没有哪份需求 README 带〈待决清单〉。</p>
          <p className="dc-muted">写法见 docs/templates/README.md：README 顶部「## 待决清单」，按 A / B / C / D 分组列表格。</p>
        </div>
      ) : (
        <div className="dc-body">
          <nav className="dc-list" aria-label="待决条目">
            <button type="button" className={cx("dc-all", overview && "is-active")} aria-current={overview ? "true" : undefined} onClick={openOverview}>
              <span>全部件套</span>
              <span className="dc-group-counts">
                {open ? `还没定 ${open}` : "都定了"}
                {openBlocking > 0 && <em>⛔ {openBlocking}</em>}
              </span>
            </button>
            {overview ? <OverviewList features={features} activeKey={snap.key} active={snap.active} /> : feature && <ItemList feature={feature} active={snap.active} />}
          </nav>
          <main className="dc-main">
            {overview && feature && item && (
              <div className="dc-from">
                <span title={feature.file}>{feature.title}</span>
                <Btn kind="ghost" size="sm" onClick={() => openFeature(feature.key, item.id)}>
                  只看这份需求
                </Btn>
              </div>
            )}
            {item ? (
              <DecisionCard key={`${snap.key}#${item.id}`} item={item} />
            ) : (
              <div className="dc-blank">{overview && !open ? "几份需求的待决清单都定了。" : "从左边选一条"}</div>
            )}
          </main>
          <RefPanel />
        </div>
      )}
      <Toast />
    </div>
  );
}
