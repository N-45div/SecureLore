import Link from "next/link";

const statusRows = [
  {
    label: "Public app pages",
    value: "Landing, privacy, and status pages are live."
  },
  {
    label: "Slack endpoints",
    value: "Commands, events, and actions are served over production HTTPS."
  },
  {
    label: "Review workflow",
    value: "Review packets, Review Room, evidence capture, and learning trace are deployed."
  },
  {
    label: "Machine health",
    value: "The JSON health endpoint is available for automated checks."
  }
];

export const metadata = {
  title: "Status"
};

export default function StatusPage() {
  return (
    <main>
      <Header />
      <section className="documentHero statusHero">
        <p className="eyebrow">Live service status</p>
        <h1>SecureLore is deployed and ready for review.</h1>
        <p>
          The production app is running on Vercel with public pages and Slack
          request endpoints available over HTTPS.
        </p>
      </section>

      <section className="statusPanel">
        <div className="statusBadge">
          <span aria-hidden="true" />
          <strong>Operational</strong>
        </div>
        <div className="statusRows">
          {statusRows.map((row) => (
            <article key={row.label}>
              <h2>{row.label}</h2>
              <p>{row.value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="notice">
        <h2>For automated checks</h2>
        <p>
          SecureLore also exposes a machine-readable health endpoint at{" "}
          <a href="/api/health">/api/health</a>. That endpoint intentionally
          returns JSON for deployment monitoring and Slack setup verification.
        </p>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="siteHeader">
      <Link className="brand" href="/">
        <span className="brandMark">SL</span>
        <span>SecureLore</span>
      </Link>
      <nav aria-label="Primary">
        <Link href="/">Home</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </header>
  );
}
