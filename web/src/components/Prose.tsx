"use client";

import type { ProsePage } from "@/content/pages";
import type { Lang } from "@/lib/preferences";
import { useI18n } from "@/lib/i18n";

export function Prose({ content }: { content: Record<Lang, ProsePage> }) {
  const { lang } = useI18n();
  const page = content[lang];
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="h2">{page.title}</h1>
          <p className="lead muted">{page.lead}</p>
        </div>
      </div>
      <article className="prose section">
        {page.sections.map((section) => (
          <section key={section.title}>
            <h2 className="h3">{section.title}</h2>
            {section.paragraphs?.map((p) => <p key={p}>{p}</p>)}
            {section.list && (
              <ul>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}
