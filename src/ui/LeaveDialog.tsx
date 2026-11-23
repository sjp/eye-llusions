import { useEffect, useId, useRef } from "preact/hooks";

type Props = {
  onLeave: () => void;
  onStay: () => void;
};

/** Asks before leaving a scene whose changes haven't been shared or saved. */
export function LeaveDialog({ onLeave, onStay }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      class="share-dialog"
      aria-labelledby={titleId}
      onClose={onStay}
      onCancel={(event) => {
        event.preventDefault();
        onStay();
      }}
    >
      <h2 id={titleId}>Leave this scene?</h2>
      <p class="panel-note">
        It has changes you haven't shared or saved. To keep them, share a link or save a PNG first.
      </p>
      <div class="share-actions">
        <button type="button" class="button" onClick={onLeave}>
          Go to gallery
        </button>
        <button type="button" class="button" autofocus onClick={onStay}>
          Keep editing
        </button>
      </div>
    </dialog>
  );
}
