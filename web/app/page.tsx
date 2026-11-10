import Link from "next/link";

export default function Landing() {
  return (
    <section className="hero">
      <h1>Find who should staff it, and why.</h1>
      <p>
        SkillPool reads resumes and project documents, maps people to the skills and projects they have
        actually worked on, and answers staffing questions with named candidates and the passages that
        back each one.
      </p>
      <div className="actions">
        <Link className="button" href="/search">Search people</Link>
        <Link className="button secondary" href="/upload">Add documents</Link>
      </div>
    </section>
  );
}
