import { z } from 'zod'

export const taskFormSchema = z.object({
  action: z.string().default(''),
  body: z.string().default(''),
  tagIds: z.array(z.string()).default([]),
  targetBranch: z.string().min(1, 'Branch is required'),
  targetRepo: z.string().min(1, 'Repository is required'),
  title: z.string().min(1, 'Title is required'),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>
