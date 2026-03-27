import { defineCollection, z } from 'astro:content';

const toolEducation = defineCollection({
  type: 'data',
  schema: z.object({
    metaTitle: z.string(),
    metaDescription: z.string(),
    hero: z.object({
      category: z.string(),
      difficulty: z.string(),
      bestFor: z.array(z.string()),
    }),
    quick: z.object({
      what: z.string(),
      use: z.string(),
      notFor: z.string(),
    }),
    learn: z.object({
      intro: z.object({
        title: z.string(),
        text: z.string(),
      }),
      how: z.object({
        title: z.string(),
        text: z.string(),
      }),
      useCases: z.object({
        title: z.string(),
        items: z.array(z.string()),
      }),
      mistake: z.object({
        title: z.string(),
        text: z.string(),
      }),
      history: z.object({
        title: z.string(),
        text: z.string(),
      }),
      security: z.object({
        title: z.string(),
        text: z.string(),
      }).optional(),
      deepDive: z.object({
        title: z.string(),
        sections: z.array(z.object({
          title: z.string(),
          text: z.string(),
        })),
      }).optional(),
    }),
    diagram: z.object({
      variant: z.enum(['base64', 'time-capsule', 'jwt', 'bcrypt', 'enigma']),
      title: z.string(),
      caption: z.string(),
    }).optional(),
  }),
});

export const collections = {
  'tool-education': toolEducation,
};
