import Link from "next/link";
import { ProductPreview } from "./product-preview";

const checks = [
  "Slack manifest review",
  "MCP tool metadata checks",
  "Scope justification packets",
  "Marketplace readiness artifacts",
  "Evidence capture inside Slack"
];

const workflows = [
  {
    title: "Builder review",
    body: "Paste a real Slack manifest or MCP tools/list response and get blockers, warnings, patch plans, and admin-ready artifacts."
  },
  {
    title: "Review Room",
    body: "Turn each review into a Slack-native room where builders add evidence, answer policy questions, and reopen the latest state from App Home."
  },
  {
    title: "Policy memory",
    body: "Ground checks against stored Slack Marketplace and platform guidance using Cohere embeddings over Neon Postgres with pgvector."
  }
];

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Slack agent and MCP preflight reviews</p>
          <h1>SecureLore</h1>
          <p className="lede">
            SecureLore helps Slack builders catch approval blockers before they
            ask an admin, submit to judges, or prepare a Marketplace review.
            It runs inside Slack, stores review evidence, and produces
            practical artifacts instead of generic chatbot advice.
          </p>
          <div className="heroActions">
            <Link className="primaryAction" href="/status">View live status</Link>
            <Link className="secondaryAction" href="/privacy">Privacy details</Link>
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="band">
        <div className="sectionIntro">
          <p className="eyebrow">What it reviews</p>
          <h2>Built for the handoff between builders and Slack admins.</h2>
        </div>
        <div className="checkGrid">
          {checks.map((check) => (
            <div className="checkItem" key={check}>
              <span aria-hidden="true">OK</span>
              <p>{check}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="workflowGrid">
        {workflows.map((workflow) => (
          <article className="workflowCard" key={workflow.title}>
            <h3>{workflow.title}</h3>
            <p>{workflow.body}</p>
          </article>
        ))}
      </section>

      <section className="disclosure">
        <div>
          <p className="eyebrow">AI and data disclosure</p>
          <h2>Review output is generated with explicit guardrails.</h2>
        </div>
        <p>
          SecureLore uses OpenRouter-hosted language models for review
          enrichment and Cohere embeddings for policy retrieval. Slack data is
          not used to train models. Review packets, feedback, and evidence are
          retained only to support the workspace review workflow and can be
          deleted on request.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}

function SiteHeader() {
  return (
    <header className="siteHeader">
      <Link className="brand" href="/">
        <span className="brandMark">SL</span>
        <span>SecureLore</span>
      </Link>
      <nav aria-label="Primary">
        <Link href="/status">Status</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="siteFooter">
      <span>SecureLore for Slack agent readiness</span>
      <nav aria-label="Footer">
        <Link href="/status">Status</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </footer>
  );
}
