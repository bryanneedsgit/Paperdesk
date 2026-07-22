export function EmptyWorkspace() {
  return (
    <div className="empty-workspace">
      <div className="empty-workspace-surface" aria-hidden="true">
        <div className="empty-page-shape" />
      </div>
      <div>
        <h2>Empty workspace</h2>
        <p>Open or drop PDFs to begin. Files stay local on this device.</p>
      </div>
    </div>
  );
}
