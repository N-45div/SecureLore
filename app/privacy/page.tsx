import Link from "next/link";

const rows = [
  {
    label: "Slack data collected",
    value:
      "Slack user, team, and channel identifiers needed to save review context; submitted manifests, MCP tools/list JSON, generated review packets, feedback, and evidence entered by users."
  },
  {
    label: "How data is used",
    value:
      "To run preflight reviews, retrieve relevant policy guidance, save review history, reopen Review Rooms, and generate admin-ready artifacts."
  },
  {
    label: "Slack Real-Time Search",
    value:
      "When a user explicitly requests workspace precedent, SecureLore searches public-channel messages using Slack's Real-Time Search API and the request's short-lived action token. Search results are displayed with Slack permalinks and are not copied into SecureLore storage, learning memory, evals, or model-training data."
  },
  {
    label: "AI providers",
    value:
      "OpenRouter-hosted language models are used for review enrichment. Cohere embeddings are used for policy retrieval over SecureLore policy memory."
  },
  {
    label: "Training",
    value:
      "SecureLore does not use Slack data, submitted manifests, MCP payloads, feedback, or evidence to train large language models."
  },
  {
    label: "Retention",
    value:
      "Review packets, feedback, and evidence are retained while the workspace uses SecureLore so users can reopen review history and admin artifacts."
  },
  {
    label: "Deletion",
    value:
      "Workspace owners or installing users can request deletion of review records, feedback, and evidence through the project submission contact."
  }
];

export const metadata = {
  title: "Privacy"
};

export default function PrivacyPage() {
  return (
    <main>
      <Header />
      <section className="documentHero">
        <p className="eyebrow">Privacy policy</p>
        <h1>How SecureLore handles Slack review data.</h1>
        <p>
          SecureLore is designed for pre-submission and admin-readiness review.
          It stores only the data needed to preserve review history, evidence,
          and generated artifacts for users in the workspace.
        </p>
      </section>
      <section className="policyTable">
        {rows.map((row) => (
          <article key={row.label}>
            <h2>{row.label}</h2>
            <p>{row.value}</p>
          </article>
        ))}
      </section>
      <section className="notice">
        <h2>Contact for privacy requests</h2>
        <p>
          For access, transfer, correction, or deletion requests, use the
          contact path listed on the Devpost project submission. Include the
          workspace name, Slack team ID if available, and the review ID when
          relevant. Do not send secrets, OAuth tokens, signing secrets, or
          private customer data in support messages.
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
        <Link href="/status">Status</Link>
      </nav>
    </header>
  );
}
