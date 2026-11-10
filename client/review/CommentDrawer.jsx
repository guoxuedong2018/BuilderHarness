import { useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";

import { getHost } from "../core/host";
import { Btn, cx, Icon, Tag } from "../core/ui";
import { confidenceHint, formatLoc, relocate } from "./anchor";
import { frsForRoute } from "./frs";
import { newReviewId, removeComment, reviewState, setAuthor, updateComment } from "./store";
import "./CommentDrawer.less";

function timeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 评论抽屉：当前页评论列表，支持筛选 / 回复 / 解决 / 删除 / 定位到 Pin。
 * 画在宿主留的抽屉格子里（原型右侧），开合时挤压原型而不是盖住它。
 */
export function CommentDrawer() {
  const snap = useSnapshot(reviewState, { sync: true });
  const [filter, setFilter] = useState("all");
  const [replyFor, setReplyFor] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const cards = useRef(new Map());
  const replyRef = useRef(null);
  const replyId = useRef(null);
  const submitting = useRef(false);

  // 选中评论变化时把对应卡片滚入可视区（已可见则不扰动，hover 不会乱跳）
  useEffect(() => {
    if (!snap.drawerOpen || !snap.activeCommentId) return;
    cards.current.get(snap.activeCommentId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [snap.activeCommentId, snap.drawerOpen]);

  useEffect(() => {
    if (replyFor) replyRef.current?.focus();
  }, [replyFor]);

  if (!snap.drawerOpen) return null;

  const routeComments = snap.comments.filter((c) => c.route === snap.route);
  const openCount = routeComments.filter((c) => c.status === "open").length;
  const list = routeComments.filter((c) => filter === "all" || c.status === filter);
  // 稳定编号 = 该评论在本页评论全集中的 1-based 序号，与页面上的 Pin 一致（不随筛选变化）
  const numberById = Object.fromEntries(routeComments.map((c, i) => [c.id, i + 1]));
  const otherRoutes = Object.entries(
    snap.comments.reduce((acc, c) => {
      if (c.status === "open" && c.route !== snap.route) acc[c.route] = (acc[c.route] ?? 0) + 1;
      return acc;
    }, {}),
  );
  const cancelReply = () => {
    setReplyFor(null);
    setReplyDraft("");
  };
  const save = async (c, action) => {
    if (submitting.current) return false;
    submitting.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setSaveError({ id: c.id, message: error.message });
      return false;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const sendReply = async (c) => {
    if (!replyDraft.trim()) return;
    const reply = { id: replyId.current, author: reviewState.author.trim() || "PM", body: replyDraft.trim(), at: new Date().toISOString() };
    if (await save(c, () => updateComment(c, { reply }))) cancelReply();
  };
  /** 三层降级重定位，直接滚到元素本身而非整页区域 */
  const locate = (c) => {
    reviewState.activeCommentId = c.id;
    relocate(c.anchor).el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <aside data-review-ui className="cd-root">
      <div className="cd-head">
        <div className="cd-head-left">
          <Icon name="chat" />
          <span className="cd-title">评论</span>
          <Tag>{routeComments.length}</Tag>
        </div>
        <button type="button" className="cd-close" aria-label="关闭评论区" onClick={() => (reviewState.drawerOpen = false)}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="cd-frs">
        <div className="cd-section-label">本页所属 FRS</div>
        <div className="cd-frs-tags">
          {frsForRoute(snap.route).map((f) => (
            <Tag key={f.key} tone="primary" title={f.title}>
              {f.key}
            </Tag>
          ))}
        </div>
      </div>

      <div className="cd-toolbar">
        <div className="cd-filters">
          {[
            { v: "all", label: "全部" },
            { v: "open", label: `未解决 ${openCount}` },
            { v: "resolved", label: "已解决" },
          ].map((f) => (
            <button key={f.v} type="button" className={cx("cd-filter", filter === f.v && "cd-filter-active")} onClick={() => setFilter(f.v)}>
              {f.label}
            </button>
          ))}
        </div>
        <input value={snap.author} title="评论人" aria-label="评论人" className="cd-author" onChange={(e) => setAuthor(e.target.value)} />
      </div>

      <div className="cd-list">
        {list.length === 0 && (
          <div className="cd-empty">
            本页暂无评论。
            <br />
            开启「评论」模式后，点选页面元素即可添加。
          </div>
        )}

        {list.map((c) => {
          // 定位置信度：源码改动导致的降级必须显式呈现，不能让批注静默漂到错误位置
          const location = relocate(c.anchor);
          const hint = confidenceHint(c.anchor, location.confidence);
          return (
            <div
              key={c.id}
              ref={(el) => (el ? cards.current.set(c.id, el) : cards.current.delete(c.id))}
              className={cx("cd-card", snap.activeCommentId === c.id && "cd-card-active")}
              onMouseEnter={() => (reviewState.activeCommentId = c.id)}
            >
              <div className="cd-card-head">
                <span className={cx("cd-num", c.status === "resolved" && "is-resolved")}>{numberById[c.id]}</span>
                <span className="cd-anchor" title={c.anchor.label}>
                  {c.anchor.label}
                </span>
                {c.status === "resolved" && <Tag tone="success">已解决</Tag>}
              </div>

              {c.anchor.src && (
                <div className="cd-src" title={formatLoc(c.anchor.src)}>
                  {formatLoc(c.anchor.src)}
                </div>
              )}
              {hint && <div className="cd-hint">{hint}</div>}
              {saveError?.id === c.id && <div className="cd-hint cd-save-error" role="alert">保存失败。{saveError.message}</div>}

              <p className="cd-body">{c.body}</p>
              <div className="cd-meta">
                {c.author} · {timeLabel(c.createdAt)}
              </div>

              {(c.replies ?? []).length > 0 && (
                <div className="cd-replies">
                  {(c.replies ?? []).map((r, i) => (
                    <div key={i} className="cd-reply">
                      <span className="cd-reply-body">{r.body}</span>
                      <span className="cd-reply-meta">
                        — {r.author} · {timeLabel(r.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {replyFor === c.id ? (
                <div className="cd-reply-box">
                  <textarea
                    ref={replyRef}
                    value={replyDraft}
                    disabled={saving}
                    className="cd-reply-input"
                    placeholder="回复…"
                    onChange={(e) => {
                      setReplyDraft(e.target.value);
                      if (saveError?.id === c.id) {
                        replyId.current = newReviewId();
                        setSaveError(null);
                      }
                    }}
                  />
                  <div className="cd-reply-actions">
                    <Btn disabled={saving} onClick={cancelReply}>取消</Btn>
                    <Btn kind="primary" disabled={saving || !replyDraft.trim()} onClick={() => sendReply(c)}>
                      {saving ? "保存中…" : "回复"}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="cd-actions">
                  <button type="button" className="cd-act" disabled={!location.el} onClick={() => locate(c)}>
                    <Icon name="locate" /> 定位
                  </button>
                  <button
                    type="button"
                    className="cd-act"
                    disabled={saving}
                    onClick={() => {
                      setReplyFor(c.id);
                      setReplyDraft("");
                      replyId.current = newReviewId();
                    }}
                  >
                    <Icon name="reply" /> 回复
                  </button>
                  <button type="button" className="cd-act" disabled={saving} onClick={() => save(c, () => updateComment(c, { status: c.status === "open" ? "resolved" : "open" }))}>
                    <Icon name={c.status === "open" ? "check" : "refresh"} /> {c.status === "open" ? "解决" : "重开"}
                  </button>
                  <button type="button" className="cd-act cd-act-danger" disabled={saving} onClick={() => save(c, () => removeComment(c))}>
                    <Icon name="trash" /> 删除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {otherRoutes.length > 0 && (
        <div className="cd-other">
          <div className="cd-section-label">其他页面待解决</div>
          {otherRoutes.map(([route, count]) => (
            <button key={route} type="button" className="cd-other-item" onClick={() => route !== snap.route && getHost().router.push(route)}>
              <span className="cd-other-route">{route}</span>
              <span className="cd-other-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {snap.memoryOnly && (
        <div className="cd-warn">
          未连接开发服务：评论仅存于当前会话，刷新丢失。运行 <code>npm run dev</code> 后自动写入 docs/reviews。
        </div>
      )}
    </aside>
  );
}
