import type { TaskEntity } from '../entities/task.entity';

export interface TaskRepository {
  findById(id: string): Promise<TaskEntity | null>;
  save(entity: TaskEntity): Promise<void>;
}

export const TASK_REPOSITORY_TOKEN = Symbol('TaskRepository');
