export type Notice = {
  tone: "error" | "info";
  text: string;
  /** A follow-up the person can choose, such as using a file another way. */
  action?: { label: string; run: () => void };
};

/** A message under the toolbar, with an optional action and a way to dismiss it. */
export function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div class={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <p>{notice.text}</p>
      {notice.action !== undefined && (
        <button type="button" class="button" onClick={notice.action.run}>
          {notice.action.label}
        </button>
      )}
      <button type="button" class="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
