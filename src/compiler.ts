import { Bus } from './bus';
import { Logger } from './logger';
import { Task, TaskRunner } from './taskrunner';
import { absolutePath } from './util';
import * as glob from 'glob';

export interface Compiler {
  start(): void;
  stop(): void;
  runOnce(tscArgs: string[]): Promise<boolean>;
}

let runningTasks: Task[] = [];
let execTasksSequential = (taskFunctions: (() => Task)[]): Promise<void> => {
  return taskFunctions.reduce((a: Promise<void>, b: () => Task) => {
    return a.then(() => {
      let running = b();
      runningTasks.push(running);
      return running.result;
    });
  }, Promise.resolve());
};

export let createCompiler = (dependencies: { taskRunner: TaskRunner, logger: Logger, bus: Bus }): Compiler => {
  let { taskRunner, logger, bus } = dependencies;

  let busy = true;
  let errors: string[] = [];

  let handleOutput = (line: string) => {
    if (/Starting incremental compilation...$/.test(line)) {
      busy = true;
      logger.log('compiler', 'compiling...');
      errors = [];
      bus.signal('compile-started');
    } else if (/Compilation complete\. Watching for file changes.$/.test(line)) {
      busy = false;
      logger.log('compiler', `ready, found ${errors.length} errors`);
      bus.signal(errors.length === 0 ? 'compile-compiled' : 'compile-errored');
    } else {
      let matches = /([^(]+)\((\d+),(\d+)\): (error TS\d+: )?(.*)$/.exec(line);
      if (matches) {
        errors.push(matches[0]);
        logger.log('compiler', `${absolutePath(matches[1])}:${matches[2]}:${matches[3]} ${matches[5]}`);
      } else {
        matches = /error TS\d+: (.+)$/.exec(line);
        if (matches) {
          errors.push(matches[1]);
          logger.log('compiler', `${matches[1]}`);
        } else {
          // just echo the output
          logger.log('compiler', line);
        }
      }
    }
    return true;
  };

  let taskFunctions: (() => Task)[] = [];

  return {
    runOnce: (tscArgs: string[]) => {
      return new Promise((resolve, reject) => {
        glob('**/tsconfig.json', { ignore: 'node_modules/**' }, (error: Error | null, tsConfigFiles: string[]) => {
          if (error) {
            reject(error);
          }
          tsConfigFiles.forEach(file => {
            let args = ['-p', file];
            if (file === 'tsconfig.json') {
              args = [...args, ...tscArgs];
            } else {
              args = [...args, '--noEmit'];
            }
            let taskFunction = () => taskRunner.runTask(`./node_modules/.bin/tsc`, args, {
              name: `tsc --project ${file}`,
              logger,
              handleOutput
            });

            taskFunctions.push(taskFunction);
          });

          resolve(execTasksSequential(taskFunctions).then(() => true));
        });
      });
    },
    start: () => {
      glob('**/tsconfig.json', { ignore: 'node_modules/**' }, (error: Error | null, tsConfigFiles: string[]) => {
        tsConfigFiles.forEach(file => {
          let taskFunction = () => taskRunner.runTask('./node_modules/.bin/tsc', ['-p', file, '--watch', '--noEmit'], {
            name: `tsc -p ${file} --watch`,
            logger,
            handleOutput
          });

          taskFunctions.push(taskFunction);
        });

        execTasksSequential(taskFunctions).then(() => true).catch(() => false);
      });
    },
    stop: () => {
      runningTasks.forEach(task => {
        task.kill();
      });
      runningTasks = [];
    }
  };
};
