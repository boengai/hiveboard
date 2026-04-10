import { z } from 'zod'

export const taskFormSchema = z.object({
  action: z.string(),
  agentInstruction: z.string(),
  body: z.string(),
  tagIds: z.array(z.string()),
  targetBranch: z.string().min(1, 'Branch is required'),
  targetRepo: z.string().min(1, 'Repository is required'),
  title: z.string().min(1, 'Title is required'),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>
