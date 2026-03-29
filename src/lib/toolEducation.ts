export type ToolEducationSlug = 'base64' | 'time-capsule' | 'jwt' | 'bcrypt';

export type ToolDiagramVariant = 'base64' | 'time-capsule' | 'jwt' | 'bcrypt';

export interface ToolEducationSection {
  title: string;
  text: string;
}

export interface ToolQuickFactsEntry {
  what: string;
  use: string;
  notFor: string;
}

export interface ToolEducationEntry {
  metaTitle: string;
  metaDescription: string;
  hero: {
    category: string;
    difficulty: string;
    bestFor: string[];
  };
  quick: ToolQuickFactsEntry;
  learn: {
    intro: ToolEducationSection;
    how: ToolEducationSection;
    useCases: {
      title: string;
      items: string[];
    };
    mistake: ToolEducationSection;
    history: ToolEducationSection;
    security?: ToolEducationSection;
    deepDive?: {
      title: string;
      sections: ToolEducationSection[];
    };
  };
  diagram?: {
    variant: ToolDiagramVariant;
    title: string;
    caption: string;
  };
}

type EducationModule = { default: ToolEducationEntry } | ToolEducationEntry;

const educationModules = import.meta.glob('../content/tool-education/*/*.json', { eager: true }) as Record<string, EducationModule>;

const educationEntries = new Map<string, ToolEducationEntry>();

for (const [path, mod] of Object.entries(educationModules)) {
  const match = path.match(/tool-education\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;

  const [, locale, slug] = match;
  const entry = ('default' in mod ? mod.default : mod) as ToolEducationEntry;
  validateEntry(entry, path);
  educationEntries.set(`${locale}:${slug}`, entry);
}

function validateEntry(entry: ToolEducationEntry, path: string) {
  if (!entry.metaTitle || !entry.metaDescription) {
    throw new Error(`Missing meta fields in ${path}`);
  }
  if (!entry.hero?.category || !entry.hero?.difficulty || !Array.isArray(entry.hero?.bestFor)) {
    throw new Error(`Missing hero fields in ${path}`);
  }
  if (!entry.quick?.what || !entry.quick?.use || !entry.quick?.notFor) {
    throw new Error(`Missing quick facts in ${path}`);
  }
  if (!entry.learn?.intro?.title || !entry.learn?.intro?.text) {
    throw new Error(`Missing intro section in ${path}`);
  }
  if (!entry.learn?.how?.title || !entry.learn?.how?.text) {
    throw new Error(`Missing how section in ${path}`);
  }
  if (!entry.learn?.useCases?.title || !Array.isArray(entry.learn?.useCases?.items)) {
    throw new Error(`Missing useCases section in ${path}`);
  }
  if (!entry.learn?.mistake?.title || !entry.learn?.mistake?.text) {
    throw new Error(`Missing mistake section in ${path}`);
  }
  if (!entry.learn?.history?.title || !entry.learn?.history?.text) {
    throw new Error(`Missing history section in ${path}`);
  }
}

export function getToolEducation(locale: string, slug: ToolEducationSlug): ToolEducationEntry {
  const direct = educationEntries.get(`${locale}:${slug}`);
  if (direct) return direct;

  const fallback = educationEntries.get(`en:${slug}`);
  if (!fallback) {
    throw new Error(`Missing tool education entry for slug "${slug}"`);
  }
  return fallback;
}
