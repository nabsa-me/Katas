import { notFound } from 'next/navigation';
import { CASES, findCase, isVariant, VARIANTS } from '../../../../../exercises/hydration-mismatch-catalog/cases';
import { CASE_COMPONENTS } from '../../../../../exercises/hydration-mismatch-catalog/catalog';

/** Every case and variant is known at build time; any other URL is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.flatMap((entry) => VARIANTS.map((variant) => ({ slug: entry.slug, variant })));
}

export default async function MismatchCasePage({ params }: PageProps<'/hydration-mismatch-catalog/[slug]/[variant]'>) {
  const { slug, variant } = await params;
  const entry = findCase(slug);
  const components = CASE_COMPONENTS[slug];
  if (!entry || !components || !isVariant(variant)) notFound();
  const Example = components[variant];

  return (
    <main className="page">
      <p className={`tag ${variant}`}>{variant}</p>
      <h1>{entry.title}</h1>
      <p className="muted">{entry.cause}</p>
      <div className="card">
        <Example />
      </div>
      <p>
        <a href="/">All exercises</a>
      </p>
    </main>
  );
}
