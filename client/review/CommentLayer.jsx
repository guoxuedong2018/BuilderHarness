import { useEffect, useReducer, useRef, useState } from "react";
import { useSnapshot } from "valtio";

import { Btn, cx } from "../core/ui";
import { CONFIDENCE_HINT, createAnchor, formatLoc, pinPosition, relocate } from "./anchor";
import { addComment, newReviewId, reviewState } from "./store";
import "./CommentLayer.less";

const isReviewUi = (el) => !!(el && el.closest("[data-review-ui]"));

/** Draft persistence (EDGE-03): a refresh or accidental close must not lose typed text. */
const DRAFT_PREFIX = "builderharness:comment-draft:";
function draftKeyOf(anchor) {
  const src = anchor?.src ? `${anchor.src.file}:${anchor.src.line}:${anchor.src.col}` : anchor?.selector || anchor?.label || "";
  const instance = anchor.sharedSource ? `:${anchor.name}:${anchor.selector}` : "";
  return `${DRAFT_PREFIX}${reviewState.route}:${src}${instance}`;
}
function readDraft(key) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage may be unavailable in private mode; typing still works
  }
}

/**
 * 元素是否属于「可批注的原型」。
 *
 * 不能只看 [data-review-root]：AppModal / AppDrawer 会被 iView 传送到 <body>，
 * 落在评审根之外，于是浮层里的元素一个都点不中——而浮层恰恰是最需要批注的地方。
 * 评审层自身不会漏进来：套件的每个根节点都带 data-review-ui，由 isReviewUi 先挡掉。
 */
const inRoot = (el) => !!(el && el.closest("[data-review-root], .app-modal, .app-drawer"));

/**
 * 评论覆盖层：评论模式下的元素点选高亮 + 输入气泡，以及始终展示的评论 Pin。
 * 点选拾取通过 window 捕获阶段监听实现；覆盖层自身不吃事件，
 * 命中测试用 document.elementFromPoint 落到真实页面元素上。
 *
 * 锚点的生成与重定位全部委托给 anchor.js 的三层链，本文件只负责交互与渲染。
 */
export function CommentLayer() {
  const snap = useSnapshot(reviewState);
  const [hover, setHover] = useState(null);
  const [composer, setComposer] = useState(null);
  const [draft, setDraft] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // 按住 ⌘/Ctrl 临时进入圈选模式，与工具栏的常驻 commentMode 并行生效
  const [metaHeld, setMetaHeld] = useState(false);
  // 滚动 / 缩放 / 抽屉开合 / 浮层开合后靠它触发 Pin 位置重算
  const [, bump] = useReducer((n) => n + 1, 0);
  const inputRef = useRef(null);
  const submitting = useRef(false);

  const picking = snap.commentMode || metaHeld;
  // 监听器挂在 window 上只注册一次，读最新值走 ref
  const live = useRef({});
  live.current = { picking, composer, draftKey };

  useEffect(() => {
    const onMove = (e) => {
      const { picking: p, composer: c } = live.current;
      if (!p || c) return setHover(null);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isReviewUi(el) || !inRoot(el)) return setHover(null);
      const r = el.getBoundingClientRect();
      setHover({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const onClick = (e) => {
      const { picking: p, composer: c } = live.current;
      if (!p || c) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isReviewUi(el) || !inRoot(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const anchor = createAnchor(el, e.clientX, e.clientY);
      const key = draftKeyOf(anchor);
      setComposer({ x: e.clientX, y: e.clientY, anchor, id: newReviewId(), route: reviewState.route });
      setDraftKey(key);
      setDraft(readDraft(key));
      setSaveError("");
      setHover(null);
    };
    const onKeyDown = (e) => {
      if (e.key === "Meta" || e.key === "Control") setMetaHeld(true);
      if (e.key !== "Escape") return;
      if (submitting.current) return;
      // Esc：先关输入气泡，否则退出评论模式。草稿留在 localStorage，
      // 重新点同一个元素还能接着写；只有显式「取消」才丢弃。
      if (live.current.composer) {
        setComposer(null);
        setDraft("");
      } else if (reviewState.commentMode) reviewState.commentMode = false;
    };
    const onKeyUp = (e) => {
      if (e.key === "Meta" || e.key === "Control") setMetaHeld(false);
    };
    const onBlur = () => setMetaHeld(false);

    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    /*
     * 盯浮层开合，触发 Pin 重算。浮层开合既不产生 scroll 也不产生 resize：重新打开弹窗时，
     * 里面已有的批注不会冒出来，看着就像批注丢了。iView 开合浮层是切 display，所以盯浮层子树的
     * style / class；浮层首次打开才被传送到 body，故同时盯 body 直接子节点的增减。
     * 观察范围只限这几个浮层容器，不铺到整页——产品页的表格改一次样式就会刷屏。
     */
    const overlays = new MutationObserver(bump);
    const watchOverlays = () => {
      for (const el of document.querySelectorAll(".app-modal, .app-drawer")) {
        overlays.observe(el, { subtree: true, attributes: true, attributeFilter: ["style", "class"] });
      }
    };
    const body = new MutationObserver(() => {
      watchOverlays();
      bump();
    });
    body.observe(document.body, { childList: true });
    watchOverlays();

    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      overlays.disconnect();
      body.disconnect();
      document.body.style.cursor = "";
    };
  }, []);

  // 圈选模式下用十字光标提示可点选
  useEffect(() => {
    document.body.style.cursor = picking && !composer ? "crosshair" : "";
  }, [picking, composer]);

  // 抽屉开合改变主内容宽度、换路由换了页面，Pin 都要跟着重算（等布局落定）
  useEffect(() => {
    const id = requestAnimationFrame(bump);
    return () => cancelAnimationFrame(id);
  }, [snap.drawerOpen, snap.route]);

  useEffect(() => {
    if (composer) inputRef.current?.focus();
  }, [composer]);

  const cancel = () => {
    setComposer(null);
    setDraft("");
    if (draftKey) writeDraft(draftKey, "");
    setDraftKey("");
    setSaveError("");
  };
  const submit = async () => {
    if (!composer || !draft.trim() || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await addComment({ id: composer.id, route: composer.route, frs: composer.anchor.frs, anchor: composer.anchor, body: draft });
      cancel();
      reviewState.drawerOpen = true;
    } catch (error) {
      setSaveError(error.message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const pins = snap.comments
    .filter((c) => c.route === snap.route)
    // 编号 = 该评论在本页评论全集中的稳定序号，与抽屉列表保持一致（先编号再过滤）
    .map((c, i) => ({ c, number: i + 1 }))
    // 已解决的不在页面上打 Pin，仍可在「评论区」抽屉查看
    .filter(({ c }) => c.status !== "resolved")
    .map(({ c, number }) => {
      // 三层降级重定位：源码坐标 → 组件语义 → 几何兜底
      const { el, confidence } = relocate(c.anchor);
      if (!el) return null; // lost：锚定元素已不存在，不打 Pin（抽屉里仍会提示）
      return { c, number, confidence, ...pinPosition(c.anchor, el) };
    })
    .filter(Boolean);

  const active = snap.activeCommentId;

  return (
    <>
      {picking && !composer && hover && (
        <div
          data-review-ui
          className="cl-hover"
          style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }}
        />
      )}

      {pins.map((p) => {
        const hint = CONFIDENCE_HINT[p.confidence];
        return (
          <button
            key={p.c.id}
            data-review-ui
            type="button"
            // 非精确定位用虚线圈提示：位置是推断出来的，不能当作准确锚点
            aria-label={`打开批注 ${p.number}：${p.c.body.slice(0, 40)}`}
            className={cx("cl-pin", p.confidence !== "exact" && "is-approx", active === p.c.id && "is-active", active && active !== p.c.id && "is-dim")}
            title={hint ? `${p.c.body}\n\n⚠ ${hint}` : p.c.body}
            style={{ left: p.left, top: p.top }}
            onClick={() => {
              reviewState.activeCommentId = p.c.id;
              reviewState.drawerOpen = true;
            }}
          >
            {p.number}
          </button>
        );
      })}

      {composer && (
        <div
          data-review-ui
          className="cl-composer"
          style={{ left: Math.min(composer.x, window.innerWidth - 300), top: Math.min(composer.y + 8, window.innerHeight - 200) }}
        >
          <div className="cl-anchor-label" title={composer.anchor.label}>
            锚点：{composer.anchor.label}
          </div>
          {composer.anchor.src && (
            <div className="cl-anchor-src" title={formatLoc(composer.anchor.src)}>
              {formatLoc(composer.anchor.src)}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            disabled={saving}
            className="cl-textarea"
            placeholder="写下对该元素的修改建议…（⌘/Ctrl + Enter 提交）"
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftKey) writeDraft(draftKey, e.target.value);
              if (saveError) {
                setComposer({ ...composer, id: newReviewId() });
                setSaveError("");
              }
            }}
            onKeyDown={(e) => {
              // EDGE-01: do not submit while an IME candidate window is composing.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          {saveError && <div className="cl-save-error" role="alert">保存失败。{saveError}</div>}
          <div className="cl-actions">
            <Btn disabled={saving} onClick={cancel}>取消</Btn>
            <Btn kind="primary" disabled={saving || !draft.trim()} onClick={submit}>
              {saving ? "保存中…" : "添加评论"}
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}
