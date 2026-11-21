import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Privacy · SkillPool" };

// Open without the access code (proxy.ts), so anyone can read it before they sign in.
// Keep it true to the code: the service and lib/access.ts are what it describes. It follows the
// notice the GDPR asks for (Article 13), and CalOPPA's points on changes and Do Not Track.
const CONTACT = "gabrielernestowch@gmail.com";
const HISTORY = "https://github.com/gbw30/Skillpool/commits/main/web/app/privacy/page.tsx";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ruled mt-10">
      <h2 className="label mb-3">{title}</h2>
      <div className="flex flex-col gap-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="page">
      <div className="mx-auto max-w-2xl">
        <p className="label">Privacy · updated 21 November 2026</p>
        <h1 className="mt-4">What this demo does with <em>your data</em></h1>
        <p className="mt-6 text-muted">
          SkillPool is a portfolio demo run by Gabriel Wong, who decides what happens to the data described here. Write to{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> about anything on this page. The people, companies and documents in
          SkillPool are fictional. The only data about real people it handles is what your visit sends.
        </p>

        <Part title="What is kept, and for how long">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>One cookie</strong>, set when you enter the access code. It holds the time you signed in, sealed so it
              cannot be forged, and lasts 30 days or until you sign out. It is needed for the site to work. There are no other
              cookies: no analytics, advertising or tracking.
            </li>
            <li>
              <strong>Your IP address</strong>, to limit how often one visitor can search, load pages or try an access code.
              It is kept in memory only while a limit needs it: it is dropped with the next request after that minute (ten
              minutes after a wrong access code), or when the server restarts. For the daily search limit, the service stores a
              one-way hash of your address and the date, keyed with a secret, and deletes it the first time it runs on a later
              day. It does not store or log the address itself.
            </li>
            <li>
              <strong>Your light or dark choice</strong>, and whether you paused the motion, in your own browser only.
            </li>
          </ul>
          <p>
            Nothing else is asked of you. The cookie and the address are required: without them the site cannot be used.
          </p>
        </Part>

        <Part title="Where your questions go">
          <p>
            A question is sent to Anthropic (Claude), which reads it and writes the short answer, and to Voyage AI (part of
            MongoDB), which turns it into numbers for the search. They receive the question only, not your address or anything
            that identifies you, and may keep it for a time under their own terms. SkillPool itself does not store your
            questions. A question started from the home page travels in the page address, so it can appear in your browser
            history and in the hosts&rsquo; logs.
          </p>
          <p>Please do not type personal information about real people into the search box.</p>
        </Part>

        <Part title="Who handles requests">
          <p>
            Vercel hosts the website and Render hosts the search service. Both keep their own request logs, which include IP
            addresses. Neo4j AuraDB holds the fictional dataset and the daily counts. Each works under its own privacy policy:{" "}
            <a href="https://vercel.com/legal/privacy-policy">Vercel</a>, <a href="https://render.com/privacy">Render</a>,{" "}
            <a href="https://www.anthropic.com/legal/privacy">Anthropic</a>,{" "}
            <a href="https://www.mongodb.com/legal/privacy/privacy-policy">MongoDB</a> and{" "}
            <a href="https://neo4j.com/privacy-policy/">Neo4j</a>.
          </p>
          <p>
            The demo is run from the United States, and all five providers are based there. A visit from elsewhere, including
            the EU and UK, therefore sends this data to the United States, where each provider relies on the safeguards in its
            own terms.
          </p>
          <p>
            Nothing is sold or shared for advertising. No other site&rsquo;s code runs on these pages, so no one can follow you
            from here to other sites.
          </p>
        </Part>

        <Part title="Do Not Track and Global Privacy Control">
          <p>
            Since nothing is sold, shared or tracked across sites, these browser signals change nothing here: the site already
            does what they ask, for everyone. It says so at <a href="/.well-known/gpc.json">/.well-known/gpc.json</a>.
          </p>
        </Part>

        <Part title="Why, and your rights">
          <p>
            These steps are what it takes to run the demo and to protect it from abuse and runaway costs. For visitors in the EU
            and UK, that is a legitimate interest (GDPR Article 6(1)(f)). The rankings are about fictional people. Apart from the
            request limits above, the site makes no automated decision about you and builds no profile of you.
          </p>
          <p>
            You can ask what is held about you, and ask for it to be corrected, deleted or limited, by writing to{" "}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. You get an answer within a month. Since the service keeps no address
            and no question, there is usually nothing to find.
          </p>
          <p>
            <strong>You can object</strong> at any time, on grounds relating to your situation, to this use of your data, at
            the same address.
          </p>
          <p>You can also complain to the data protection authority where you live or work.</p>
        </Part>

        <Part title="Children">
          <p>SkillPool is not meant for children under 16 and does not knowingly collect their data.</p>
        </Part>

        <Part title="Changes to this page">
          <p>
            A change is posted here with a new date at the top. Every earlier version is in{" "}
            <a href={HISTORY}>the page&rsquo;s history on GitHub</a>.
          </p>
        </Part>
      </div>
    </div>
  );
}
