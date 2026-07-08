import Link from "next/link";

const supportItems = [
  {
    title: "Installation and Slack setup",
    body:
      "Confirm the Slack command, event, and interactivity URLs point to the production HTTPS deployment."
  },
  {
    title: "Review output questions",
    body:
      "Share the review ID and the finding that looks incorrect. SecureLore can record feedback and evidence for follow-up."
  },
  {
    title: "Data requests",
    body:
      "Request deletion or export of review records, feedback, and evidence connected to your workspace."
  }
];

export const metadata = {
  title: "Support"
};

export default function SupportPage() {
  return (
    <main>
      <Header />
      <section className="documentHero">
        <p className="eyebrow">Support</p>
        <h1>Get help with SecureLore reviews and Slack setup.</h1>
        <p>
          SecureLore support is focused on install issues, review accuracy,
          data requests, and submission-readiness questions for Slack agent and
          MCP projects.
        </p>
      </section>
      <section className="workflowGrid">
        {supportItems.map((item) => (
          <article className="workflowCard" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>
      <section className="notice">
        <h2>Support contact</h2>
        <p>
          Email support requests to <a href="mailto:securelore-support@example.com">securelore-support@example.com</a>.
          Support requests should receive a response within two business days.
        </p>
        <p>
          Include the Slack workspace name, review ID, and a short description
          of the issue. Do not send secrets, OAuth tokens, signing secrets, or
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
        <Link href="/privacy">Privacy</Link>
      </nav>
    </header>
  );
}
