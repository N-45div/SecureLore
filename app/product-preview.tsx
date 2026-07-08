export function ProductPreview() {
  return (
    <div className="productPreview" aria-label="SecureLore Slack review preview">
      <div className="slackRail">
        <div />
        <div />
        <div />
      </div>
      <div className="slackSurface">
        <div className="surfaceTop">
          <span># agent-review</span>
          <span>SecureLore</span>
        </div>
        <div className="reviewPacket">
          <div className="packetHeader">
            <span>SecureLore review</span>
            <strong>REJECT</strong>
          </div>
          <p>
            5 blocker(s) and 2 warning(s) found. Address blockers before
            asking admins to approve the app.
          </p>
          <div className="finding blocker">Broad history scope requested</div>
          <div className="finding blocker">AI disclosure is incomplete</div>
          <div className="finding warn">files:read needs evidence</div>
          <div className="buttonRow">
            <span>Admin brief</span>
            <span>Patch plan</span>
            <span>Add evidence</span>
          </div>
        </div>
        <div className="reviewRoom">
          <strong>Review Room</strong>
          <p>Risk: REJECT - Evidence captured: 2</p>
          <div className="evidenceLine">Scope reason added by builder</div>
        </div>
      </div>
    </div>
  );
}
