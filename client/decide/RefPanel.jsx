import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";

import { Btn } from "../core/ui";
import { Cell, REF_KIND, renderBlock } from "./cell";
import { StatusTag } from "./DecisionCard";
import { closeRef, decideState, itemsOf, openFeature, openItem } from "./store";

/** 同件套的另一条：直接用手上的数据摆，引用照样能点 */
function ItemPreview({ it }) {
  return (
    <div className="dc-refitem">
      <div className="dc-refitem-head">
        <b>{it.id}</b>
        <StatusTag status={it.status} />
      </div>
      <Cell className="dc-refitem-q" text={it.question} refs={it.refs.question} />
      {it.recommend && (
        <>
          <h4>{it.headers.recommend ?? "我的建议"}</h4>
          <Cell block text={it.recommend.text} refs={it.refs.recommend} />
        </>
      )}
      {it.why && (
        <>
          <h4>{it.headers.why ?? "为什么重要"}</h4>
          <Cell block text={it.why} refs={it.refs.why} />
        </>
      )}
      <h4>{it.headers.conclusion ?? "结论"}</h4>
      {it.conclusion.trim() ? <Cell block text={it.conclusion} refs={it.refs.conclusion} /> : <p className="dc-muted">还没有</p>}
    </div>
  );
}

/**
 * 点开的引用，在卡片右边就地看原文：不离开这张卡，正在写的也不丢。
 * 事实、节、DECISIONS 条目、别的件套由服务现读；同一份的另一条直接摆。
 */
export function RefPanel() {
  const { ref, feature, features } = useSnapshot(decideState);
  const closeRefBtn = useRef(null);

  useEffect(() => {
    if (!ref) return undefined;
    const onKey = (e) => e.key === "Escape" && closeRef();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
  useEffect(() => {
    if (ref) closeRefBtn.current?.focus({ preventScroll: true });
  }, [ref?.kind, ref?.target]);

  if (!ref) return null;
  const item = ref.kind === "item" ? itemsOf(feature).find((it) => it.id === ref.target) : null;
  const data = ref.data;
  const title = item ? `${item.id} · ${REF_KIND.item}` : (data?.title ?? ref.label);
  const where = item ? `${feature.file}:${item.line}` : data?.where;
  const [otherKey, otherItem] = String(ref.target).split("#");
  const canOpen = (ref.kind === "feature" || ref.kind === "feature-item") && features.some((f) => f.key === otherKey);

  return (
    <aside className="dc-refpanel" aria-label="引用的原文">
      <header className="dc-refpanel-head">
        <div className="dc-refpanel-title">
          <span className="dc-refpanel-kind">{REF_KIND[ref.kind]}</span>
          <b>{title}</b>
          {where && <code>{where}</code>}
        </div>
        <button ref={closeRefBtn} type="button" className="dc-x" aria-label="关掉原文" onClick={closeRef}>
          ×
        </button>
      </header>
      <div className="dc-refpanel-body dc-md">
        {item ? (
          <ItemPreview it={item} />
        ) : ref.loading ? (
          <p className="dc-muted">读取中…</p>
        ) : ref.error ? (
          <p className="dc-warn-text">{ref.error}</p>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderBlock(data?.markdown ?? "") }} />
        )}
      </div>
      {(item || canOpen) && (
        <footer className="dc-refpanel-foot">
          {item && (
            <Btn
              onClick={() => {
                openItem(item.id);
                closeRef();
              }}
            >
              打开这张卡
            </Btn>
          )}
          {canOpen && <Btn onClick={() => openFeature(otherKey, otherItem ?? null)}>{otherItem ? `在决策页打开那份的 ${otherItem}` : "在决策页打开那份"}</Btn>}
        </footer>
      )}
    </aside>
  );
}
