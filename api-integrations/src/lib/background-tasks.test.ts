import { describe, expect, it, vi } from 'vitest';
import { createBackgroundTasks } from './background-tasks';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createBackgroundTasks', () => {
  it('returns at once and runs the task afterwards', async () => {
    const tasks = createBackgroundTasks(vi.fn());
    const done: string[] = [];
    tasks.run(async () => {
      await tick(5);
      done.push('task');
    });
    expect(done).toEqual([]);
    expect(tasks.pending).toBe(1);
    await tasks.drain();
    expect(done).toEqual(['task']);
    expect(tasks.pending).toBe(0);
  });

  it('waits for tasks started by other tasks', async () => {
    const tasks = createBackgroundTasks(vi.fn());
    const done: string[] = [];
    tasks.run(async () => {
      await tick(1);
      tasks.run(async () => {
        await tick(5);
        done.push('follow-up');
      });
    });
    await tasks.drain();
    expect(done).toEqual(['follow-up']);
  });

  it('reports failures to onError instead of rejecting', async () => {
    const onError = vi.fn();
    const tasks = createBackgroundTasks(onError);
    tasks.run(async () => {
      throw new Error('downstream is down');
    });
    await tasks.drain();
    expect(onError).toHaveBeenCalledWith(new Error('downstream is down'));
  });
});
