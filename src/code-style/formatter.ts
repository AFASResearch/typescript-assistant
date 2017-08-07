import { Bus, EventType } from '../bus';
import { Git } from '../git';
import { Logger } from '../logger';
import { absolutePath, isTypescriptFile } from '../util';

import { Options, processFiles, ResultMap } from 'typescript-formatter';

let replaceOptions: Options = {
  replace: true,
  verbose: false,
  baseDir: process.cwd(),
  editorconfig: true,
  tslint: true,
  tsfmt: true,
  verify: false,
  tsconfig: undefined,
  tsconfigFile: undefined,
  tslintFile: undefined,
  tsfmtFile: undefined,
  vscode: false
};

let verifyOptions: Options = {
  replace: false,
  verbose: false,
  baseDir: process.cwd(),
  editorconfig: true,
  tslint: true,
  tsfmt: true,
  verify: true,
  tsconfig: undefined,
  tsconfigFile: undefined,
  tslintFile: undefined,
  tsfmtFile: undefined,
  vscode: false
};

export interface Formatter {
  format(): Promise<boolean>;
  verifyAll(files: string[]): Promise<boolean>;
  startVerifying(triggers: EventType[]): void;
  stopVerifying(): void;
}

export let createFormatter = (dependencies: { logger: Logger, git: Git, bus: Bus }): Formatter => {
  let { logger, bus, git } = dependencies;

  let runFormatterOn = (files: string[], options: Options): Promise<boolean> => {
    logger.log('formatter', `checking ${files.length} files...`);
    return processFiles(files, options).then((resultMap: ResultMap) => {
      let success = true;
      Object.keys(resultMap).forEach((fileName: string) => {
        let result = resultMap[fileName];
        if (result.error) {
          success = false;
        }
        if (result.message) {
          logger.log('formatter', `${options.replace ? 'Fixed ' : ''}${absolutePath(fileName)}: ${result.message}`);
        }
      });
      return success;
    });
  };

  let runFormatter = (options: Options) => {
    return git.findChangedFilesOrAllTypescriptFiles().then((files: string[]) => {
      files = files.filter(isTypescriptFile);
      return runFormatterOn(files, options);
    });
  };

  let verifyFormat = () => {
    // needs re-entrant fix
    return runFormatter(verifyOptions).then((success) => {
      logger.log('formatter', success ? 'all files formatted' : 'unformatted files found');
      bus.signal(success ? 'format-verified' : 'format-errored');
    });
  };

  return {
    verifyAll: (files) => {
      return runFormatterOn(files, verifyOptions);
    },
    format: () => {
      return runFormatter(replaceOptions);
    },
    startVerifying: (triggers: EventType[]) => {
      bus.registerAll(triggers, verifyFormat);
      verifyFormat();
    },
    stopVerifying: () => {
      bus.unregister(verifyFormat);
    }
  };
};
