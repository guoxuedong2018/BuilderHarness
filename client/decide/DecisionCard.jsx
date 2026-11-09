import { useState } from "react";
import { useSnapshot } from "valtio";

import { Btn, cx } from "../core/ui";
import { Cell } from "./cell";
import { EMPTY_DRAFT, STATUS_LABEL, copyText, decideState, draftKey, notify, openRef, plain, setDraft, submit, withdraw } from "./store";

const two = (n) => String(n).padStart(2, "0");
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export function StatusTag({ status }) {
  return <span className={cx("dc-status", `is-${status}`)}>{STATUS_LABEL[status]}</span>;
}

/** 提交出错时把原因冒出来；成功由 store 统一提示 */
async function guarded(fn, setBusy) {
  setBusy(true);
  try {
    await fn();
  } catch (e) {
    notify(e.message, "error");
  } finally {
    setBusy(false);
  }
}

/** A 组：「我的建议」是一个选项（标推荐、不预选），备选按 ①②③ 各成一项，再加「写自己的方案」 */
function Options({ item, d, interactive }) {
  const opts = [
    item.recommend && { value: "recommend", mark: "推荐", text: item.recommend.text, refs: item.refs.recommend },
    ...item.alternatives.map((a, k) => ({ value: `alt${k}`, mark: a.mark || "备选", text: a.text, refs: item.refs[`alt${k}`] })),
  ].filter(Boolean);
  if (!opts.length && !interactive) return null;
  const name = `dc-choice-${item.id}`;
  const pick = (value) => setDraft(item.id, { choice: value });

  return (
    <fieldset className="dc-options">
      <legend>{interactive ? "选一个，或写自己的方案" : "建议与备选"}</legend>
      {opts.map((o) => (
        <label key={o.value} className={cx("dc-opt", interactive && "is-pickable", d.choice === o.value && "is-on")}>
          {interactive && <input type="radio" name={name} checked={d.choice === o.value} onChange={() => pick(o.value)} />}
          <span className={cx("dc-opt-mark", o.value === "recommend" && "is-recommend")}>{o.mark}</span>
          <Cell className="dc-opt-text" block text={o.text} refs={o.refs} />
        </label>
      ))}
      {interactive && (
        <div className={cx("dc-opt", "is-pickable", d.choice === "own" && "is-on")}>
          <label className="dc-opt-own">
            <input type="radio" name={name} checked={d.choice === "own"} onChange={() => pick("own")} />
            <span className="dc-opt-mark">自己的</span>
            <span>写自己的方案</span>
          </label>
          {d.choice === "own" && (
            <textarea
              className="dc-input"
              rows={3}
              autoFocus
              aria-label="自己的方案"
              value={d.own}
              placeholder="照你的原话写，Agent 会原样记进「你的结论」"
              onChange={(e) => setDraft(item.id, { own: e.target.value })}
            />
          )}
        </div>
      )}
    </fieldset>
  );
}

function DecideForm({ item, d }) {
  const [busy, setBusy] = useState(false);
  const noOptions = !item.recommend && item.alternatives.length === 0;
  const choice = noOptions ? "own" : d.choice;
  const ready = choice && (choice !== "own" || d.own.trim());
  const go = () =>
    guarded(() => {
      const alt = /^alt(\d+)$/.exec(choice ?? "");
      const picked =
        choice === "recommend"
          ? { kind: "recommend", text: item.recommend.text }
          : alt
            ? { kind: "alt", mark: item.alternatives[Number(alt[1])].mark, text: item.alternatives[Number(alt[1])].text }
            : { kind: "own", text: d.own.trim() };
      return submit(item, { action: "decide", choice: picked, body: d.note });
    }, setBusy);

  return (
    <>
      {noOptions ? (
        <label className="dc-field">
          <span>你的决定</span>
          <textarea className="dc-input" rows={3} value={d.own} placeholder="照你的原话写，Agent 会原样记进「你的结论」" onChange={(e) => setDraft(item.id, { own: e.target.value })} />
        </label>
      ) : (
        <Options item={item} d={d} interactive />
      )}
      <label className="dc-field">
        <span>补充说明（选填）</span>
        <textarea className="dc-input" rows={2} value={d.note} placeholder="条件、例外、为什么这么定，原话照记" onChange={(e) => setDraft(item.id, { note: e.target.value })} />
      </label>
      <div className="dc-actions">
        <Btn kind="primary" size="lg" disabled={!ready || busy} onClick={go}>
          {busy ? "提交中…" : "提交"}
        </Btn>
        {d.editing && (
          <Btn kind="ghost" onClick={() => setDraft(item.id, { editing: false })}>
            取消
          </Btn>
        )}
      </div>
    </>
  );
}

/** B / C / D：问到的结果 + 谁、哪天、哪个渠道 */
function AnswerForm({ item, d }) {
  const [busy, setBusy] = useState(false);
  const meeting = item.group === "D";
  const go = () => guarded(() => submit(item, { action: "answer", body: d.answer, source: d.source }), setBusy);
  return (
    <>
      <label className="dc-field">
        <span>{meeting ? "会上定的结果" : "问到的结果"}</span>
        <textarea className="dc-input" rows={3} value={d.answer} placeholder="对方的原话，或你整理的结论" onChange={(e) => setDraft(item.id, { answer: e.target.value })} />
      </label>
      <label className="dc-field">
        <span>{meeting ? "哪次会、哪天、谁在场" : "谁、哪天、哪个渠道"}</span>
        <input
          className="dc-input"
          value={d.source}
          placeholder={meeting ? "例：11-05 需求评审会 · 研发、业务、测试" : "例：后端负责人 · 11-05 · 群聊"}
          onChange={(e) => setDraft(item.id, { source: e.target.value })}
        />
      </label>
      <div className="dc-actions">
        <Btn kind="primary" size="lg" disabled={!d.answer.trim() || !d.source.trim() || busy} onClick={go}>
          {busy ? "提交中…" : "提交"}
        </Btn>
        {d.editing && (
          <Btn kind="ghost" onClick={() => setDraft(item.id, { editing: false })}>
            取消
          </Btn>
        )}
      </div>
    </>
  );
}

function RejectForm({ item, d }) {
  const [busy, setBusy] = useState(false);
  const go = () => guarded(() => submit(item, { action: "reject", body: d.reject }), setBusy);
  return (
    <div className="dc-reject">
      <label className="dc-field">
        <span>这一条哪里不对</span>
        <textarea
          className="dc-input"
          rows={2}
          autoFocus
          value={d.reject}
          placeholder="例：问偏了，真正要定的是…；建议的前提不成立；漏了一种做法"
          onChange={(e) => setDraft(item.id, { reject: e.target.value })}
        />
      </label>
      <div className="dc-actions">
        <Btn kind="primary" disabled={!d.reject.trim() || busy} onClick={go}>
          {busy ? "提交中…" : "打回"}
        </Btn>
        <Btn kind="ghost" onClick={() => setDraft(item.id, { rejecting: false })}>
          取消
        </Btn>
      </div>
    </div>
  );
}

/** 选中的那项只写结论那一句：全文就在下面的选项里，不再摆一遍 */
function headOf(text) {
  const bold = /^\*\*([^*]+)\*\*/.exec(text ?? "");
  const first = bold ? bold[1] : plain(text).split("。")[0];
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

function choiceText(r) {
  if (r.action === "reject") return "打回";
  if (r.action === "answer") return "问到的结果";
  const c = r.choice ?? {};
  return c.kind === "recommend" ? "选了推荐" : c.kind === "alt" ? `选了备选 ${c.mark ?? ""}` : "自己的方案";
}

/** 提交了还没记进 README 的：Agent 记完、标已处理之前都在这里，可以撤回 */
function Submissions({ item }) {
  const [busy, setBusy] = useState(false);
  const col = item.headers.conclusion ?? "结论";
  // README 那一格已经写定、这一行也改过：记过了，只差标已处理
  const recorded = item.status === "decided";
  return (
    <section className="dc-subs" aria-label="已提交、等记录">
      <h3>{recorded ? "README 已经写上了，这条提交还没标已处理" : "你提交的，等 Agent 记进 README"}</h3>
      {item.submissions.map((r) => (
        <div key={r.id} className="dc-sub">
          <div className="dc-sub-head">
            <b>{choiceText(r)}</b>
            <time dateTime={r.createdAt}>{when(r.createdAt)}</time>
            {r.changed && <span className="dc-warn">提交后这一行改过</span>}
            <Btn size="sm" kind="ghost" disabled={busy} onClick={() => guarded(() => withdraw(r), setBusy)}>
              撤回
            </Btn>
          </div>
          {r.choice && r.choice.kind !== "own" && <p className="dc-sub-choice">{headOf(r.choice.text)}</p>}
          {r.choice?.kind === "own" && <p className="dc-sub-words">{r.choice.text}</p>}
          {!r.choice && r.body && <p className="dc-sub-words">{r.body}</p>}
          {r.note && <p className="dc-sub-words">{r.note}</p>}
          {r.source && <p className="dc-muted">来源：{r.source}</p>}
        </div>
      ))}
      {!recorded && <p className="dc-muted">在对话里跟 Agent 说一声「记录决定」：它把结论写进 README 的「{col}」列，这张卡随之变成「已定」。</p>}
    </section>
  );
}

/** 依据与牵动：格子里认出来的引用汇在一处；别的条目提到这一条，也算牵动 */
function Basis({ item }) {
  const seen = new Set();
  const all = Object.values(item.refs)
    .flat()
    .filter((r) => {
      const k = `${r.kind}:${r.target}`;
      return !seen.has(k) && seen.add(k);
    });
  const basis = all.filter((r) => r.kind !== "item");
  const linked = all.filter((r) => r.kind === "item");
  // 互相提到的只摆一次
  const by = item.mentionedBy.filter((id) => !linked.some((r) => r.target === id));
  if (!basis.length && !linked.length && !by.length) return null;
  return (
    <section className="dc-basis" aria-label="依据与牵动">
      {basis.length > 0 && (
        <div className="dc-basis-row">
          <span className="dc-basis-label">依据</span>
          {basis.map((r) => (
            <button key={`${r.kind}:${r.target}`} type="button" className={cx("dc-ref", `is-${r.kind}`)} onClick={() => openRef(r)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {(linked.length > 0 || by.length > 0) && (
        <div className="dc-basis-row">
          <span className="dc-basis-label">牵动</span>
          {linked.map((r) => (
            <button key={r.target} type="button" className="dc-ref is-item" title="这一条提到它" onClick={() => openRef(r)}>
              {r.label}
            </button>
          ))}
          {by.map((id) => (
            <button key={`by-${id}`} type="button" className="dc-ref is-item" title="它提到了这一条" onClick={() => openRef({ kind: "item", target: id, label: id })}>
              {id} 提到这条
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 问题：开头加粗的那句当标题，后面的细节（B / C 组常有一长串）排在标题下面，不全挤进标题。
 * 引用按位置分到两边
 */
function Question({ item }) {
  const text = item.question;
  const refs = item.refs.question ?? [];
  const head = /^\*\*[^*]+\*\*\s*/.exec(text);
  const cut = head && head[0].length < text.trim().length ? head[0].length : text.length;
  const more = text.slice(cut);
  return (
    <>
      <Cell as="h2" id={`dc-q-${item.id}`} className="dc-q" text={text.slice(0, cut)} refs={refs.filter((r) => r.end <= cut)} />
      {more.trim() && <Cell block className="dc-q-more" text={more} refs={refs.filter((r) => r.start >= cut).map((r) => ({ ...r, start: r.start - cut, end: r.end - cut }))} />}
    </>
  );
}

/**
 * 一张卡。A 组是拍板：选建议、备选或写自己的；B / C / D 是记录问到的结果。
 * 任何一张都能打回。卡上的结论永远取 README 那一格：页面只是输入口，不留副本。
 */
export function DecisionCard({ item }) {
  // 卡上的输入框都受控于草稿：必须同步订阅。valtio 默认批量、晚一拍才通知，React 在输入事件后先按旧值
  // 把输入框改回去，中文输入法组字到一半就被打断（拼音上屏、字重复、光标跳到末尾）
  const snap = useSnapshot(decideState, { sync: true });
  const d = snap.drafts[draftKey(item.id)] ?? EMPTY_DRAFT;
  const isA = item.group === "A";
  const open = item.status === "pending" || item.status === "provisional" || item.status === "needs-review" || d.editing;
  const col = item.headers.conclusion ?? (isA ? "你的结论" : "确认结果");
  const copy = () => copyText([plain(item.question), item.why && `（为什么问：${plain(item.why)}）`].filter(Boolean).join("\n"));

  return (
    <article className="dc-card" aria-labelledby={`dc-q-${item.id}`}>
      <header className="dc-head">
        <span className="dc-id">{item.id}</span>
        {item.qualifier && <span className="dc-qual">{item.qualifier}</span>}
        <StatusTag status={item.status} />
        {item.blocking && <span className="dc-block">⛔ 定稿前必须有答案</span>}
        <span className="dc-head-right">
          {!isA && (
            <Btn title="复制问题与「为什么重要」，去问研发或业务" onClick={copy}>
              复制问题
            </Btn>
          )}
          <Btn kind="ghost" aria-expanded={d.rejecting} title="这一条本身不对：问偏了、建议站不住、漏了做法" onClick={() => setDraft(item.id, { rejecting: !d.rejecting })}>
            打回
          </Btn>
        </span>
      </header>

      <Question item={item} />

      {item.why && (
        <section className="dc-sec">
          <h3>{item.headers.why ?? "为什么重要"}</h3>
          <Cell block text={item.why} refs={item.refs.why} />
        </section>
      )}

      {d.rejecting && <RejectForm item={item} d={d} />}

      {item.conclusion.trim() && (
        <section className={cx("dc-sec", "dc-conclusion", `is-${item.state}`)}>
          <h3>README 里的「{col}」</h3>
          <Cell block text={item.conclusion} refs={item.refs.conclusion} />
        </section>
      )}
      {item.landing && (
        <section className="dc-sec">
          <h3>{item.headers.landing ?? "落到哪"}</h3>
          <Cell block text={item.landing} refs={item.refs.landing} />
        </section>
      )}
      {item.extra.map((x, k) => (
        <section key={x.label} className="dc-sec">
          <h3>{x.label}</h3>
          <Cell block text={x.text} refs={item.refs[`extra${k}`]} />
        </section>
      ))}

      {item.submissions.length > 0 && <Submissions item={item} />}

      {isA && !open && <Options item={item} d={d} interactive={false} />}
      {open ? (
        isA ? (
          <DecideForm item={item} d={d} />
        ) : (
          <AnswerForm item={item} d={d} />
        )
      ) : (
        item.status === "decided" && (
          <div className="dc-actions">
            <Btn onClick={() => setDraft(item.id, { editing: true })}>{isA ? "改判" : "改一下结果"}</Btn>
          </div>
        )
      )}

      <Basis item={item} />
    </article>
  );
}
