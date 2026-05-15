#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/error.js
var require_error = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/error.js"(exports2) {
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports2.CommanderError = CommanderError2;
    exports2.InvalidArgumentError = InvalidArgumentError2;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/argument.js"(exports2) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.length > 3 && this._name.slice(-3) === "...") {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports2.Argument = Argument2;
    exports2.humanReadableArgName = humanReadableArgName;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/help.js
var require_help = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/help.js"(exports2) {
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.minWidthToWrap = 40;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * prepareContext is called by Commander after applying overrides from `Command.configureHelp()`
       * and just before calling `formatHelp()`.
       *
       * Commander just uses the helpWidth and the rest is provided for optional use by more complex subclasses.
       *
       * @param {{ error?: boolean, helpWidth?: number, outputHasColors?: boolean }} contextOptions
       */
      prepareContext(contextOptions) {
        this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a, b) => {
            return a.name().localeCompare(b.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(
            max,
            this.displayWidth(
              helper.styleSubcommandTerm(helper.subcommandTerm(command))
            )
          );
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(
            max,
            this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option)))
          );
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(
            max,
            this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option)))
          );
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(
            max,
            this.displayWidth(
              helper.styleArgumentTerm(helper.argumentTerm(argument))
            )
          );
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescription = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescription}`;
          }
          return extraDescription;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth ?? 80;
        function callFormatItem(term, description) {
          return helper.formatItem(term, termWidth, description, helper);
        }
        let output = [
          `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
          ""
        ];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.boxWrap(
              helper.styleCommandDescription(commandDescription),
              helpWidth
            ),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return callFormatItem(
            helper.styleArgumentTerm(helper.argumentTerm(argument)),
            helper.styleArgumentDescription(helper.argumentDescription(argument))
          );
        });
        if (argumentList.length > 0) {
          output = output.concat([
            helper.styleTitle("Arguments:"),
            ...argumentList,
            ""
          ]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return callFormatItem(
            helper.styleOptionTerm(helper.optionTerm(option)),
            helper.styleOptionDescription(helper.optionDescription(option))
          );
        });
        if (optionList.length > 0) {
          output = output.concat([
            helper.styleTitle("Options:"),
            ...optionList,
            ""
          ]);
        }
        if (helper.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return callFormatItem(
              helper.styleOptionTerm(helper.optionTerm(option)),
              helper.styleOptionDescription(helper.optionDescription(option))
            );
          });
          if (globalOptionList.length > 0) {
            output = output.concat([
              helper.styleTitle("Global Options:"),
              ...globalOptionList,
              ""
            ]);
          }
        }
        const commandList = helper.visibleCommands(cmd).map((cmd2) => {
          return callFormatItem(
            helper.styleSubcommandTerm(helper.subcommandTerm(cmd2)),
            helper.styleSubcommandDescription(helper.subcommandDescription(cmd2))
          );
        });
        if (commandList.length > 0) {
          output = output.concat([
            helper.styleTitle("Commands:"),
            ...commandList,
            ""
          ]);
        }
        return output.join("\n");
      }
      /**
       * Return display width of string, ignoring ANSI escape sequences. Used in padding and wrapping calculations.
       *
       * @param {string} str
       * @returns {number}
       */
      displayWidth(str) {
        return stripColor(str).length;
      }
      /**
       * Style the title for displaying in the help. Called with 'Usage:', 'Options:', etc.
       *
       * @param {string} str
       * @returns {string}
       */
      styleTitle(str) {
        return str;
      }
      styleUsage(str) {
        return str.split(" ").map((word) => {
          if (word === "[options]") return this.styleOptionText(word);
          if (word === "[command]") return this.styleSubcommandText(word);
          if (word[0] === "[" || word[0] === "<")
            return this.styleArgumentText(word);
          return this.styleCommandText(word);
        }).join(" ");
      }
      styleCommandDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleOptionDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleSubcommandDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleArgumentDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleDescriptionText(str) {
        return str;
      }
      styleOptionTerm(str) {
        return this.styleOptionText(str);
      }
      styleSubcommandTerm(str) {
        return str.split(" ").map((word) => {
          if (word === "[options]") return this.styleOptionText(word);
          if (word[0] === "[" || word[0] === "<")
            return this.styleArgumentText(word);
          return this.styleSubcommandText(word);
        }).join(" ");
      }
      styleArgumentTerm(str) {
        return this.styleArgumentText(str);
      }
      styleOptionText(str) {
        return str;
      }
      styleArgumentText(str) {
        return str;
      }
      styleSubcommandText(str) {
        return str;
      }
      styleCommandText(str) {
        return str;
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Detect manually wrapped and indented strings by checking for line break followed by whitespace.
       *
       * @param {string} str
       * @returns {boolean}
       */
      preformatted(str) {
        return /\n[^\S\r\n]/.test(str);
      }
      /**
       * Format the "item", which consists of a term and description. Pad the term and wrap the description, indenting the following lines.
       *
       * So "TTT", 5, "DDD DDDD DD DDD" might be formatted for this.helpWidth=17 like so:
       *   TTT  DDD DDDD
       *        DD DDD
       *
       * @param {string} term
       * @param {number} termWidth
       * @param {string} description
       * @param {Help} helper
       * @returns {string}
       */
      formatItem(term, termWidth, description, helper) {
        const itemIndent = 2;
        const itemIndentStr = " ".repeat(itemIndent);
        if (!description) return itemIndentStr + term;
        const paddedTerm = term.padEnd(
          termWidth + term.length - helper.displayWidth(term)
        );
        const spacerWidth = 2;
        const helpWidth = this.helpWidth ?? 80;
        const remainingWidth = helpWidth - termWidth - spacerWidth - itemIndent;
        let formattedDescription;
        if (remainingWidth < this.minWidthToWrap || helper.preformatted(description)) {
          formattedDescription = description;
        } else {
          const wrappedDescription = helper.boxWrap(description, remainingWidth);
          formattedDescription = wrappedDescription.replace(
            /\n/g,
            "\n" + " ".repeat(termWidth + spacerWidth)
          );
        }
        return itemIndentStr + paddedTerm + " ".repeat(spacerWidth) + formattedDescription.replace(/\n/g, `
${itemIndentStr}`);
      }
      /**
       * Wrap a string at whitespace, preserving existing line breaks.
       * Wrapping is skipped if the width is less than `minWidthToWrap`.
       *
       * @param {string} str
       * @param {number} width
       * @returns {string}
       */
      boxWrap(str, width) {
        if (width < this.minWidthToWrap) return str;
        const rawLines = str.split(/\r\n|\n/);
        const chunkPattern = /[\s]*[^\s]+/g;
        const wrappedLines = [];
        rawLines.forEach((line) => {
          const chunks = line.match(chunkPattern);
          if (chunks === null) {
            wrappedLines.push("");
            return;
          }
          let sumChunks = [chunks.shift()];
          let sumWidth = this.displayWidth(sumChunks[0]);
          chunks.forEach((chunk) => {
            const visibleWidth = this.displayWidth(chunk);
            if (sumWidth + visibleWidth <= width) {
              sumChunks.push(chunk);
              sumWidth += visibleWidth;
              return;
            }
            wrappedLines.push(sumChunks.join(""));
            const nextChunk = chunk.trimStart();
            sumChunks = [nextChunk];
            sumWidth = this.displayWidth(nextChunk);
          });
          wrappedLines.push(sumChunks.join(""));
        });
        return wrappedLines.join("\n");
      }
    };
    function stripColor(str) {
      const sgrPattern = /\x1b\[\d*(;\d*)*m/g;
      return str.replace(sgrPattern, "");
    }
    exports2.Help = Help2;
    exports2.stripColor = stripColor;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/option.js
var require_option = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/option.js"(exports2) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as an object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        if (this.negate) {
          return camelcase(this.name().replace(/^no-/, ""));
        }
        return camelcase(this.name());
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => {
        return str2 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const shortFlagExp = /^-[^-]$/;
      const longFlagExp = /^--[^-]/;
      const flagParts = flags.split(/[ |,]+/).concat("guard");
      if (shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
      if (longFlagExp.test(flagParts[0])) longFlag = flagParts.shift();
      if (!shortFlag && shortFlagExp.test(flagParts[0]))
        shortFlag = flagParts.shift();
      if (!shortFlag && longFlagExp.test(flagParts[0])) {
        shortFlag = longFlag;
        longFlag = flagParts.shift();
      }
      if (flagParts[0].startsWith("-")) {
        const unsupportedFlag = flagParts[0];
        const baseError = `option creation failed due to '${unsupportedFlag}' in option flags '${flags}'`;
        if (/^-[^-][^-]/.test(unsupportedFlag))
          throw new Error(
            `${baseError}
- a short flag is a single dash and a single character
  - either use a single dash and a single character (for a short flag)
  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`
          );
        if (shortFlagExp.test(unsupportedFlag))
          throw new Error(`${baseError}
- too many short flags`);
        if (longFlagExp.test(unsupportedFlag))
          throw new Error(`${baseError}
- too many long flags`);
        throw new Error(`${baseError}
- unrecognised flag format`);
      }
      if (shortFlag === void 0 && longFlag === void 0)
        throw new Error(
          `option creation failed due to no flags found in '${flags}'.`
        );
      return { shortFlag, longFlag };
    }
    exports2.Option = Option2;
    exports2.DualOptions = DualOptions;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/suggestSimilar.js"(exports2) {
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d = [];
      for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
      }
      for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
      }
      for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          }
        }
      }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a, b) => a.localeCompare(b));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports2.suggestSimilar = suggestSimilar;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js
var require_command = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/lib/command.js"(exports2) {
    var EventEmitter3 = require("node:events").EventEmitter;
    var childProcess = require("node:child_process");
    var path = require("node:path");
    var fs = require("node:fs");
    var process2 = require("node:process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2, stripColor } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter3 {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = false;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._savedState = null;
        this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          outputError: (str, write) => write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          getOutHasColors: () => useColor() ?? (process2.stdout.isTTY && process2.stdout.hasColors?.()),
          getErrHasColors: () => useColor() ?? (process2.stderr.isTTY && process2.stderr.hasColors?.()),
          stripColor: (str) => stripColor(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // change how output being written, defaults to stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // change how output being written for errors, defaults to writeErr
       *     outputError(str, write) // used for displaying errors and not used for displaying help
       *     // specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // color support, currently only used with Help
       *     getOutHasColors()
       *     getErrHasColors()
       *     stripColor() // used to remove ANSI escape codes if output does not have colors
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof fn === "function") {
          argument.default(defaultValue).argParser(fn);
        } else {
          argument.default(fn);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          return this;
        }
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._concatValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m = regex.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('--pt, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process2.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv[1];
              userArgs = argv.slice(2);
            } else {
              userArgs = argv.slice(1);
            }
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        this._prepareForParse();
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        this._prepareForParse();
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      _prepareForParse() {
        if (this._savedState === null) {
          this.saveStateBeforeParse();
        } else {
          this.restoreStateBeforeParse();
        }
      }
      /**
       * Called the first time parse is called to save state and allow a restore before subsequent calls to parse.
       * Not usually called directly, but available for subclasses to save their custom state.
       *
       * This is called in a lazy way. Only commands used in parsing chain will have state saved.
       */
      saveStateBeforeParse() {
        this._savedState = {
          // name is stable if supplied by author, but may be unspecified for root command and deduced during parsing
          _name: this._name,
          // option values before parse have default values (including false for negated options)
          // shallow clones
          _optionValues: { ...this._optionValues },
          _optionValueSources: { ...this._optionValueSources }
        };
      }
      /**
       * Restore state before parse for calls after the first.
       * Not usually called directly, but available for subclasses to save their custom state.
       *
       * This is called in a lazy way. Only commands used in parsing chain will have state restored.
       */
      restoreStateBeforeParse() {
        if (this._storeOptionsAsProperties)
          throw new Error(`Can not call parse again when storeOptionsAsProperties is true.
- either make a new Command for each call to parse, or stop storing options as properties`);
        this._name = this._savedState._name;
        this._scriptPath = null;
        this.rawArgs = [];
        this._optionValues = { ...this._savedState._optionValues };
        this._optionValueSources = { ...this._savedState._optionValueSources };
        this.args = [];
        this.processedArgs = [];
      }
      /**
       * Throw if expected executable is missing. Add lots of help for author.
       *
       * @param {string} executableFile
       * @param {string} executableDir
       * @param {string} subcommandName
       */
      _checkForMissingExecutable(executableFile, executableDir, subcommandName) {
        if (fs.existsSync(executableFile)) return;
        const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
        const executableMissing = `'${executableFile}' does not exist
 - if '${subcommandName}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
        throw new Error(executableMissing);
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path.resolve(baseDir, baseName);
          if (fs.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs.realpathSync(this._scriptPath);
          } catch {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path.resolve(
            path.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path.basename(
              this._scriptPath,
              path.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          this._checkForMissingExecutable(
            executableFile,
            executableDir,
            subcommand._name
          );
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            this._checkForMissingExecutable(
              executableFile,
              executableDir,
              subcommand._name
            );
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        subCommand._prepareForParse();
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v) => {
                  return myParseArg(declaredArg, v, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Side effects: modifies command by storing options. Does not reset state if called again.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        const args = argv.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        while (args.length) {
          const arg = args.shift();
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args.shift();
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (args.length > 0 && !maybeOption(args[0])) {
                  value = args.shift();
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                args.unshift(`-${arg.slice(2)}`);
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg)) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`);
          this._exit(0, "commander.version", str);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path.basename(filename, path.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path2) {
        if (path2 === void 0) return this._executableDir;
        this._executableDir = path2;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        const context = this._getOutputContext(contextOptions);
        helper.prepareContext({
          error: context.error,
          helpWidth: context.helpWidth,
          outputHasColors: context.hasColors
        });
        const text = helper.formatHelp(this, helper);
        if (context.hasColors) return text;
        return this._outputConfiguration.stripColor(text);
      }
      /**
       * @typedef HelpContext
       * @type {object}
       * @property {boolean} error
       * @property {number} helpWidth
       * @property {boolean} hasColors
       * @property {function} write - includes stripColor if needed
       *
       * @returns {HelpContext}
       * @private
       */
      _getOutputContext(contextOptions) {
        contextOptions = contextOptions || {};
        const error = !!contextOptions.error;
        let baseWrite;
        let hasColors;
        let helpWidth;
        if (error) {
          baseWrite = (str) => this._outputConfiguration.writeErr(str);
          hasColors = this._outputConfiguration.getErrHasColors();
          helpWidth = this._outputConfiguration.getErrHelpWidth();
        } else {
          baseWrite = (str) => this._outputConfiguration.writeOut(str);
          hasColors = this._outputConfiguration.getOutHasColors();
          helpWidth = this._outputConfiguration.getOutHelpWidth();
        }
        const write = (str) => {
          if (!hasColors) str = this._outputConfiguration.stripColor(str);
          return baseWrite(str);
        };
        return { error, write, hasColors, helpWidth };
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const outputContext = this._getOutputContext(contextOptions);
        const eventContext = {
          error: outputContext.error,
          write: outputContext.write,
          command: this
        };
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", eventContext));
        this.emit("beforeHelp", eventContext);
        let helpInformation = this.helpInformation({ error: outputContext.error });
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        outputContext.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", eventContext);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", eventContext)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
          } else {
            this._helpOption = null;
          }
          return this;
        }
        flags = flags ?? "-h, --help";
        description = description ?? "display help for command";
        this._helpOption = this.createOption(flags, description);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = Number(process2.exitCode ?? 0);
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * // Do a little typing to coordinate emit and listener for the help text events.
       * @typedef HelpTextEventContext
       * @type {object}
       * @property {boolean} error
       * @property {Command} command
       * @property {function} write
       */
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text === "function") {
            helpStr = text({ error: context.error, command: context.command });
          } else {
            helpStr = text;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    function useColor() {
      if (process2.env.NO_COLOR || process2.env.FORCE_COLOR === "0" || process2.env.FORCE_COLOR === "false")
        return false;
      if (process2.env.FORCE_COLOR || process2.env.CLICOLOR_FORCE !== void 0)
        return true;
      return void 0;
    }
    exports2.Command = Command2;
    exports2.useColor = useColor;
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/index.js
var require_commander = __commonJS({
  "../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/index.js"(exports2) {
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports2.program = new Command2();
    exports2.createCommand = (name) => new Command2(name);
    exports2.createOption = (flags, description) => new Option2(flags, description);
    exports2.createArgument = (name, description) => new Argument2(name, description);
    exports2.Command = Command2;
    exports2.Option = Option2;
    exports2.Argument = Argument2;
    exports2.Help = Help2;
    exports2.CommanderError = CommanderError2;
    exports2.InvalidArgumentError = InvalidArgumentError2;
    exports2.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMode.js
var require_QRMode = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMode.js"(exports2, module2) {
    module2.exports = {
      MODE_NUMBER: 1 << 0,
      MODE_ALPHA_NUM: 1 << 1,
      MODE_8BIT_BYTE: 1 << 2,
      MODE_KANJI: 1 << 3
    };
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QR8bitByte.js
var require_QR8bitByte = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QR8bitByte.js"(exports2, module2) {
    var QRMode = require_QRMode();
    function QR8bitByte(data) {
      this.mode = QRMode.MODE_8BIT_BYTE;
      this.data = data;
    }
    QR8bitByte.prototype = {
      getLength: function() {
        return this.data.length;
      },
      write: function(buffer) {
        for (var i = 0; i < this.data.length; i++) {
          buffer.put(this.data.charCodeAt(i), 8);
        }
      }
    };
    module2.exports = QR8bitByte;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMath.js
var require_QRMath = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMath.js"(exports2, module2) {
    var QRMath = {
      glog: function(n) {
        if (n < 1) {
          throw new Error("glog(" + n + ")");
        }
        return QRMath.LOG_TABLE[n];
      },
      gexp: function(n) {
        while (n < 0) {
          n += 255;
        }
        while (n >= 256) {
          n -= 255;
        }
        return QRMath.EXP_TABLE[n];
      },
      EXP_TABLE: new Array(256),
      LOG_TABLE: new Array(256)
    };
    for (i = 0; i < 8; i++) {
      QRMath.EXP_TABLE[i] = 1 << i;
    }
    var i;
    for (i = 8; i < 256; i++) {
      QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
    }
    var i;
    for (i = 0; i < 255; i++) {
      QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
    }
    var i;
    module2.exports = QRMath;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRPolynomial.js
var require_QRPolynomial = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRPolynomial.js"(exports2, module2) {
    var QRMath = require_QRMath();
    function QRPolynomial(num, shift) {
      if (num.length === void 0) {
        throw new Error(num.length + "/" + shift);
      }
      var offset = 0;
      while (offset < num.length && num[offset] === 0) {
        offset++;
      }
      this.num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i++) {
        this.num[i] = num[i + offset];
      }
    }
    QRPolynomial.prototype = {
      get: function(index) {
        return this.num[index];
      },
      getLength: function() {
        return this.num.length;
      },
      multiply: function(e) {
        var num = new Array(this.getLength() + e.getLength() - 1);
        for (var i = 0; i < this.getLength(); i++) {
          for (var j = 0; j < e.getLength(); j++) {
            num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
          }
        }
        return new QRPolynomial(num, 0);
      },
      mod: function(e) {
        if (this.getLength() - e.getLength() < 0) {
          return this;
        }
        var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
        var num = new Array(this.getLength());
        for (var i = 0; i < this.getLength(); i++) {
          num[i] = this.get(i);
        }
        for (var x = 0; x < e.getLength(); x++) {
          num[x] ^= QRMath.gexp(QRMath.glog(e.get(x)) + ratio);
        }
        return new QRPolynomial(num, 0).mod(e);
      }
    };
    module2.exports = QRPolynomial;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMaskPattern.js
var require_QRMaskPattern = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRMaskPattern.js"(exports2, module2) {
    module2.exports = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRUtil.js
var require_QRUtil = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRUtil.js"(exports2, module2) {
    var QRMode = require_QRMode();
    var QRPolynomial = require_QRPolynomial();
    var QRMath = require_QRMath();
    var QRMaskPattern = require_QRMaskPattern();
    var QRUtil = {
      PATTERN_POSITION_TABLE: [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
      ],
      G15: 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0,
      G18: 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0,
      G15_MASK: 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1,
      getBCHTypeInfo: function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
          d ^= QRUtil.G15 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15);
        }
        return (data << 10 | d) ^ QRUtil.G15_MASK;
      },
      getBCHTypeNumber: function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
          d ^= QRUtil.G18 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18);
        }
        return data << 12 | d;
      },
      getBCHDigit: function(data) {
        var digit = 0;
        while (data !== 0) {
          digit++;
          data >>>= 1;
        }
        return digit;
      },
      getPatternPosition: function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
      },
      getMask: function(maskPattern, i, j) {
        switch (maskPattern) {
          case QRMaskPattern.PATTERN000:
            return (i + j) % 2 === 0;
          case QRMaskPattern.PATTERN001:
            return i % 2 === 0;
          case QRMaskPattern.PATTERN010:
            return j % 3 === 0;
          case QRMaskPattern.PATTERN011:
            return (i + j) % 3 === 0;
          case QRMaskPattern.PATTERN100:
            return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
          case QRMaskPattern.PATTERN101:
            return i * j % 2 + i * j % 3 === 0;
          case QRMaskPattern.PATTERN110:
            return (i * j % 2 + i * j % 3) % 2 === 0;
          case QRMaskPattern.PATTERN111:
            return (i * j % 3 + (i + j) % 2) % 2 === 0;
          default:
            throw new Error("bad maskPattern:" + maskPattern);
        }
      },
      getErrorCorrectPolynomial: function(errorCorrectLength) {
        var a = new QRPolynomial([1], 0);
        for (var i = 0; i < errorCorrectLength; i++) {
          a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
        }
        return a;
      },
      getLengthInBits: function(mode, type) {
        if (1 <= type && type < 10) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 10;
            case QRMode.MODE_ALPHA_NUM:
              return 9;
            case QRMode.MODE_8BIT_BYTE:
              return 8;
            case QRMode.MODE_KANJI:
              return 8;
            default:
              throw new Error("mode:" + mode);
          }
        } else if (type < 27) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 12;
            case QRMode.MODE_ALPHA_NUM:
              return 11;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 10;
            default:
              throw new Error("mode:" + mode);
          }
        } else if (type < 41) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 14;
            case QRMode.MODE_ALPHA_NUM:
              return 13;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 12;
            default:
              throw new Error("mode:" + mode);
          }
        } else {
          throw new Error("type:" + type);
        }
      },
      getLostPoint: function(qrCode) {
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0;
        var col = 0;
        for (row = 0; row < moduleCount; row++) {
          for (col = 0; col < moduleCount; col++) {
            var sameCount = 0;
            var dark = qrCode.isDark(row, col);
            for (var r = -1; r <= 1; r++) {
              if (row + r < 0 || moduleCount <= row + r) {
                continue;
              }
              for (var c = -1; c <= 1; c++) {
                if (col + c < 0 || moduleCount <= col + c) {
                  continue;
                }
                if (r === 0 && c === 0) {
                  continue;
                }
                if (dark === qrCode.isDark(row + r, col + c)) {
                  sameCount++;
                }
              }
            }
            if (sameCount > 5) {
              lostPoint += 3 + sameCount - 5;
            }
          }
        }
        for (row = 0; row < moduleCount - 1; row++) {
          for (col = 0; col < moduleCount - 1; col++) {
            var count = 0;
            if (qrCode.isDark(row, col)) count++;
            if (qrCode.isDark(row + 1, col)) count++;
            if (qrCode.isDark(row, col + 1)) count++;
            if (qrCode.isDark(row + 1, col + 1)) count++;
            if (count === 0 || count === 4) {
              lostPoint += 3;
            }
          }
        }
        for (row = 0; row < moduleCount; row++) {
          for (col = 0; col < moduleCount - 6; col++) {
            if (qrCode.isDark(row, col) && !qrCode.isDark(row, col + 1) && qrCode.isDark(row, col + 2) && qrCode.isDark(row, col + 3) && qrCode.isDark(row, col + 4) && !qrCode.isDark(row, col + 5) && qrCode.isDark(row, col + 6)) {
              lostPoint += 40;
            }
          }
        }
        for (col = 0; col < moduleCount; col++) {
          for (row = 0; row < moduleCount - 6; row++) {
            if (qrCode.isDark(row, col) && !qrCode.isDark(row + 1, col) && qrCode.isDark(row + 2, col) && qrCode.isDark(row + 3, col) && qrCode.isDark(row + 4, col) && !qrCode.isDark(row + 5, col) && qrCode.isDark(row + 6, col)) {
              lostPoint += 40;
            }
          }
        }
        var darkCount = 0;
        for (col = 0; col < moduleCount; col++) {
          for (row = 0; row < moduleCount; row++) {
            if (qrCode.isDark(row, col)) {
              darkCount++;
            }
          }
        }
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;
        return lostPoint;
      }
    };
    module2.exports = QRUtil;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js
var require_QRErrorCorrectLevel = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js"(exports2, module2) {
    module2.exports = {
      L: 1,
      M: 0,
      Q: 3,
      H: 2
    };
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRRSBlock.js
var require_QRRSBlock = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRRSBlock.js"(exports2, module2) {
    var QRErrorCorrectLevel = require_QRErrorCorrectLevel();
    function QRRSBlock(totalCount, dataCount) {
      this.totalCount = totalCount;
      this.dataCount = dataCount;
    }
    QRRSBlock.RS_BLOCK_TABLE = [
      // L
      // M
      // Q
      // H
      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],
      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],
      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],
      // 4		
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],
      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],
      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],
      // 7		
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],
      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],
      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],
      // 10		
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],
      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],
      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],
      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],
      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],
      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12],
      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],
      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],
      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],
      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],
      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],
      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],
      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],
      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],
      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],
      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],
      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],
      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],
      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],
      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],
      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],
      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],
      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],
      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],
      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],
      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],
      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],
      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],
      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],
      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],
      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];
    QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
      var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
      if (rsBlock === void 0) {
        throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
      }
      var length = rsBlock.length / 3;
      var list = [];
      for (var i = 0; i < length; i++) {
        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];
        for (var j = 0; j < count; j++) {
          list.push(new QRRSBlock(totalCount, dataCount));
        }
      }
      return list;
    };
    QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {
      switch (errorCorrectLevel) {
        case QRErrorCorrectLevel.L:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectLevel.M:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectLevel.Q:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectLevel.H:
          return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    module2.exports = QRRSBlock;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRBitBuffer.js
var require_QRBitBuffer = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/QRBitBuffer.js"(exports2, module2) {
    function QRBitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    QRBitBuffer.prototype = {
      get: function(index) {
        var bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
      },
      put: function(num, length) {
        for (var i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) == 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        var bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module2.exports = QRBitBuffer;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/index.js
var require_QRCode = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/vendor/QRCode/index.js"(exports2, module2) {
    var QR8bitByte = require_QR8bitByte();
    var QRUtil = require_QRUtil();
    var QRPolynomial = require_QRPolynomial();
    var QRRSBlock = require_QRRSBlock();
    var QRBitBuffer = require_QRBitBuffer();
    function QRCode(typeNumber, errorCorrectLevel) {
      this.typeNumber = typeNumber;
      this.errorCorrectLevel = errorCorrectLevel;
      this.modules = null;
      this.moduleCount = 0;
      this.dataCache = null;
      this.dataList = [];
    }
    QRCode.prototype = {
      addData: function(data) {
        var newData = new QR8bitByte(data);
        this.dataList.push(newData);
        this.dataCache = null;
      },
      isDark: function(row, col) {
        if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
          throw new Error(row + "," + col);
        }
        return this.modules[row][col];
      },
      getModuleCount: function() {
        return this.moduleCount;
      },
      make: function() {
        if (this.typeNumber < 1) {
          var typeNumber = 1;
          for (typeNumber = 1; typeNumber < 40; typeNumber++) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);
            var buffer = new QRBitBuffer();
            var totalDataCount = 0;
            for (var i = 0; i < rsBlocks.length; i++) {
              totalDataCount += rsBlocks[i].dataCount;
            }
            for (var x = 0; x < this.dataList.length; x++) {
              var data = this.dataList[x];
              buffer.put(data.mode, 4);
              buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
              data.write(buffer);
            }
            if (buffer.getLengthInBits() <= totalDataCount * 8)
              break;
          }
          this.typeNumber = typeNumber;
        }
        this.makeImpl(false, this.getBestMaskPattern());
      },
      makeImpl: function(test, maskPattern) {
        this.moduleCount = this.typeNumber * 4 + 17;
        this.modules = new Array(this.moduleCount);
        for (var row = 0; row < this.moduleCount; row++) {
          this.modules[row] = new Array(this.moduleCount);
          for (var col = 0; col < this.moduleCount; col++) {
            this.modules[row][col] = null;
          }
        }
        this.setupPositionProbePattern(0, 0);
        this.setupPositionProbePattern(this.moduleCount - 7, 0);
        this.setupPositionProbePattern(0, this.moduleCount - 7);
        this.setupPositionAdjustPattern();
        this.setupTimingPattern();
        this.setupTypeInfo(test, maskPattern);
        if (this.typeNumber >= 7) {
          this.setupTypeNumber(test);
        }
        if (this.dataCache === null) {
          this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
        }
        this.mapData(this.dataCache, maskPattern);
      },
      setupPositionProbePattern: function(row, col) {
        for (var r = -1; r <= 7; r++) {
          if (row + r <= -1 || this.moduleCount <= row + r) continue;
          for (var c = -1; c <= 7; c++) {
            if (col + c <= -1 || this.moduleCount <= col + c) continue;
            if (0 <= r && r <= 6 && (c === 0 || c === 6) || 0 <= c && c <= 6 && (r === 0 || r === 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      },
      getBestMaskPattern: function() {
        var minLostPoint = 0;
        var pattern = 0;
        for (var i = 0; i < 8; i++) {
          this.makeImpl(true, i);
          var lostPoint = QRUtil.getLostPoint(this);
          if (i === 0 || minLostPoint > lostPoint) {
            minLostPoint = lostPoint;
            pattern = i;
          }
        }
        return pattern;
      },
      createMovieClip: function(target_mc, instance_name, depth) {
        var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
        var cs = 1;
        this.make();
        for (var row = 0; row < this.modules.length; row++) {
          var y = row * cs;
          for (var col = 0; col < this.modules[row].length; col++) {
            var x = col * cs;
            var dark = this.modules[row][col];
            if (dark) {
              qr_mc.beginFill(0, 100);
              qr_mc.moveTo(x, y);
              qr_mc.lineTo(x + cs, y);
              qr_mc.lineTo(x + cs, y + cs);
              qr_mc.lineTo(x, y + cs);
              qr_mc.endFill();
            }
          }
        }
        return qr_mc;
      },
      setupTimingPattern: function() {
        for (var r = 8; r < this.moduleCount - 8; r++) {
          if (this.modules[r][6] !== null) {
            continue;
          }
          this.modules[r][6] = r % 2 === 0;
        }
        for (var c = 8; c < this.moduleCount - 8; c++) {
          if (this.modules[6][c] !== null) {
            continue;
          }
          this.modules[6][c] = c % 2 === 0;
        }
      },
      setupPositionAdjustPattern: function() {
        var pos = QRUtil.getPatternPosition(this.typeNumber);
        for (var i = 0; i < pos.length; i++) {
          for (var j = 0; j < pos.length; j++) {
            var row = pos[i];
            var col = pos[j];
            if (this.modules[row][col] !== null) {
              continue;
            }
            for (var r = -2; r <= 2; r++) {
              for (var c = -2; c <= 2; c++) {
                if (Math.abs(r) === 2 || Math.abs(c) === 2 || r === 0 && c === 0) {
                  this.modules[row + r][col + c] = true;
                } else {
                  this.modules[row + r][col + c] = false;
                }
              }
            }
          }
        }
      },
      setupTypeNumber: function(test) {
        var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
        for (var i = 0; i < 18; i++) {
          mod = !test && (bits >> i & 1) === 1;
          this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
        }
        for (var x = 0; x < 18; x++) {
          mod = !test && (bits >> x & 1) === 1;
          this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
        }
      },
      setupTypeInfo: function(test, maskPattern) {
        var data = this.errorCorrectLevel << 3 | maskPattern;
        var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
        for (var v = 0; v < 15; v++) {
          mod = !test && (bits >> v & 1) === 1;
          if (v < 6) {
            this.modules[v][8] = mod;
          } else if (v < 8) {
            this.modules[v + 1][8] = mod;
          } else {
            this.modules[this.moduleCount - 15 + v][8] = mod;
          }
        }
        for (var h = 0; h < 15; h++) {
          mod = !test && (bits >> h & 1) === 1;
          if (h < 8) {
            this.modules[8][this.moduleCount - h - 1] = mod;
          } else if (h < 9) {
            this.modules[8][15 - h - 1 + 1] = mod;
          } else {
            this.modules[8][15 - h - 1] = mod;
          }
        }
        this.modules[this.moduleCount - 8][8] = !test;
      },
      mapData: function(data, maskPattern) {
        var inc = -1;
        var row = this.moduleCount - 1;
        var bitIndex = 7;
        var byteIndex = 0;
        for (var col = this.moduleCount - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          while (true) {
            for (var c = 0; c < 2; c++) {
              if (this.modules[row][col - c] === null) {
                var dark = false;
                if (byteIndex < data.length) {
                  dark = (data[byteIndex] >>> bitIndex & 1) === 1;
                }
                var mask = QRUtil.getMask(maskPattern, row, col - c);
                if (mask) {
                  dark = !dark;
                }
                this.modules[row][col - c] = dark;
                bitIndex--;
                if (bitIndex === -1) {
                  byteIndex++;
                  bitIndex = 7;
                }
              }
            }
            row += inc;
            if (row < 0 || this.moduleCount <= row) {
              row -= inc;
              inc = -inc;
              break;
            }
          }
        }
      }
    };
    QRCode.PAD0 = 236;
    QRCode.PAD1 = 17;
    QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
      var buffer = new QRBitBuffer();
      for (var i = 0; i < dataList.length; i++) {
        var data = dataList[i];
        buffer.put(data.mode, 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
        data.write(buffer);
      }
      var totalDataCount = 0;
      for (var x = 0; x < rsBlocks.length; x++) {
        totalDataCount += rsBlocks[x].dataCount;
      }
      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")");
      }
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(false);
      }
      while (true) {
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(QRCode.PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(QRCode.PAD1, 8);
      }
      return QRCode.createBytes(buffer, rsBlocks);
    };
    QRCode.createBytes = function(buffer, rsBlocks) {
      var offset = 0;
      var maxDcCount = 0;
      var maxEcCount = 0;
      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);
      for (var r = 0; r < rsBlocks.length; r++) {
        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i++) {
          dcdata[r][i] = 255 & buffer.buffer[i + offset];
        }
        offset += dcCount;
        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var x = 0; x < ecdata[r].length; x++) {
          var modIndex = x + modPoly.getLength() - ecdata[r].length;
          ecdata[r][x] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
        }
      }
      var totalCodeCount = 0;
      for (var y = 0; y < rsBlocks.length; y++) {
        totalCodeCount += rsBlocks[y].totalCount;
      }
      var data = new Array(totalCodeCount);
      var index = 0;
      for (var z = 0; z < maxDcCount; z++) {
        for (var s = 0; s < rsBlocks.length; s++) {
          if (z < dcdata[s].length) {
            data[index++] = dcdata[s][z];
          }
        }
      }
      for (var xx = 0; xx < maxEcCount; xx++) {
        for (var t = 0; t < rsBlocks.length; t++) {
          if (xx < ecdata[t].length) {
            data[index++] = ecdata[t][xx];
          }
        }
      }
      return data;
    };
    module2.exports = QRCode;
  }
});

// ../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/lib/main.js
var require_main = __commonJS({
  "../../node_modules/.pnpm/qrcode-terminal@0.12.0/node_modules/qrcode-terminal/lib/main.js"(exports2, module2) {
    var QRCode = require_QRCode();
    var QRErrorCorrectLevel = require_QRErrorCorrectLevel();
    var black = "\x1B[40m  \x1B[0m";
    var white = "\x1B[47m  \x1B[0m";
    var toCell = function(isBlack) {
      return isBlack ? black : white;
    };
    var repeat = function(color) {
      return {
        times: function(count) {
          return new Array(count).join(color);
        }
      };
    };
    var fill = function(length, value) {
      var arr = new Array(length);
      for (var i = 0; i < length; i++) {
        arr[i] = value;
      }
      return arr;
    };
    module2.exports = {
      error: QRErrorCorrectLevel.L,
      generate: function(input, opts, cb) {
        if (typeof opts === "function") {
          cb = opts;
          opts = {};
        }
        var qrcode2 = new QRCode(-1, this.error);
        qrcode2.addData(input);
        qrcode2.make();
        var output = "";
        if (opts && opts.small) {
          var BLACK = true, WHITE = false;
          var moduleCount = qrcode2.getModuleCount();
          var moduleData = qrcode2.modules.slice();
          var oddRow = moduleCount % 2 === 1;
          if (oddRow) {
            moduleData.push(fill(moduleCount, WHITE));
          }
          var platte = {
            WHITE_ALL: "\u2588",
            WHITE_BLACK: "\u2580",
            BLACK_WHITE: "\u2584",
            BLACK_ALL: " "
          };
          var borderTop = repeat(platte.BLACK_WHITE).times(moduleCount + 3);
          var borderBottom = repeat(platte.WHITE_BLACK).times(moduleCount + 3);
          output += borderTop + "\n";
          for (var row = 0; row < moduleCount; row += 2) {
            output += platte.WHITE_ALL;
            for (var col = 0; col < moduleCount; col++) {
              if (moduleData[row][col] === WHITE && moduleData[row + 1][col] === WHITE) {
                output += platte.WHITE_ALL;
              } else if (moduleData[row][col] === WHITE && moduleData[row + 1][col] === BLACK) {
                output += platte.WHITE_BLACK;
              } else if (moduleData[row][col] === BLACK && moduleData[row + 1][col] === WHITE) {
                output += platte.BLACK_WHITE;
              } else {
                output += platte.BLACK_ALL;
              }
            }
            output += platte.WHITE_ALL + "\n";
          }
          if (!oddRow) {
            output += borderBottom;
          }
        } else {
          var border = repeat(white).times(qrcode2.getModuleCount() + 3);
          output += border + "\n";
          qrcode2.modules.forEach(function(row2) {
            output += white;
            output += row2.map(toCell).join("");
            output += white + "\n";
          });
          output += border;
        }
        if (cb) cb(output);
        else console.log(output);
      },
      setErrorLevel: function(error) {
        this.error = QRErrorCorrectLevel[error] || this.error;
      }
    };
  }
});

// ../../node_modules/.pnpm/commander@13.1.0/node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// ../core/dist/usecases/DownloadSingleVideoUseCase.js
var import_node_events = require("node:events");
var import_node_path = require("node:path");

// ../core/dist/domain/TaskStatus.js
var TaskStatus;
(function(TaskStatus2) {
  TaskStatus2["Created"] = "created";
  TaskStatus2["Resolving"] = "resolving";
  TaskStatus2["Downloading"] = "downloading";
  TaskStatus2["Merging"] = "merging";
  TaskStatus2["Completed"] = "completed";
  TaskStatus2["Failed"] = "failed";
  TaskStatus2["Cancelled"] = "cancelled";
})(TaskStatus || (TaskStatus = {}));
var TERMINAL_STATUSES = /* @__PURE__ */ new Set([
  TaskStatus.Completed,
  TaskStatus.Failed,
  TaskStatus.Cancelled
]);

// ../core/dist/domain/DownloadResult.js
var DownloadErrorCode;
(function(DownloadErrorCode2) {
  DownloadErrorCode2["INPUT_PARSE_ERROR"] = "INPUT_PARSE_ERROR";
  DownloadErrorCode2["RESOURCE_NOT_FOUND"] = "RESOURCE_NOT_FOUND";
  DownloadErrorCode2["LOGIN_REQUIRED"] = "LOGIN_REQUIRED";
  DownloadErrorCode2["NETWORK_ERROR"] = "NETWORK_ERROR";
  DownloadErrorCode2["DOWNLOAD_ERROR"] = "DOWNLOAD_ERROR";
  DownloadErrorCode2["MERGE_ERROR"] = "MERGE_ERROR";
  DownloadErrorCode2["DISK_FULL"] = "DISK_FULL";
  DownloadErrorCode2["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
})(DownloadErrorCode || (DownloadErrorCode = {}));

// ../core/dist/events/DownloadEvent.js
var DownloadEventType;
(function(DownloadEventType2) {
  DownloadEventType2["TaskStarted"] = "task:started";
  DownloadEventType2["TaskResolved"] = "task:resolved";
  DownloadEventType2["StreamSelected"] = "stream:selected";
  DownloadEventType2["DownloadProgress"] = "download:progress";
  DownloadEventType2["MergeProgress"] = "merge:progress";
  DownloadEventType2["TaskCompleted"] = "task:completed";
  DownloadEventType2["TaskFailed"] = "task:failed";
  DownloadEventType2["TaskCancelled"] = "task:cancelled";
})(DownloadEventType || (DownloadEventType = {}));

// ../core/dist/usecases/DownloadSingleVideoUseCase.js
var DownloadSingleVideoUseCase = class extends import_node_events.EventEmitter {
  deps;
  abortController = null;
  constructor(deps) {
    super();
    this.deps = deps;
  }
  /**
   * 执行下载
   * @param request 下载请求
   * @returns 下载结果
   */
  async execute(request) {
    const startTime = Date.now();
    let resolveMs = 0;
    let downloadMs = 0;
    let mergeMs = 0;
    let tempDir = null;
    let hasFailed = false;
    this.abortController = new AbortController();
    try {
      this.emitEvent({
        type: DownloadEventType.TaskStarted,
        request,
        status: TaskStatus.Created
      });
      const parseStart = Date.now();
      let parseResult;
      try {
        parseResult = await this.deps.resourceParser.parse(request.input);
      } catch (err) {
        return this.failResult(DownloadErrorCode.INPUT_PARSE_ERROR, `\u65E0\u6CD5\u89E3\u6790\u8F93\u5165: ${err.message}`, startTime);
      }
      resolveMs = Date.now() - parseStart;
      const cookieString = await this.resolveCookieString(request.cookieFile);
      const videoInfo = await this.deps.streamProvider.getVideoInfo(parseResult.bvid);
      const targetPageIndex = (request.page ?? 1) - 1;
      const targetPage = videoInfo.pages[targetPageIndex];
      if (!targetPage) {
        return this.failResult(DownloadErrorCode.RESOURCE_NOT_FOUND, `\u5206 P ${targetPageIndex + 1} \u4E0D\u5B58\u5728 (\u5171 ${videoInfo.pages.length}P)`, startTime);
      }
      const cid = targetPage.cid;
      const pageSuffix = videoInfo.pages.length > 1 ? ` P${targetPageIndex + 1}` : "";
      const fullTitle = `${videoInfo.title}${pageSuffix}`;
      const playStreams = await this.deps.streamProvider.getPlayStreams({
        bvid: parseResult.bvid,
        cid,
        resourceType: parseResult.type,
        cookieString
      });
      const videoStream = this.selectBestStream(playStreams.videoStreams, request.videoCodec, request.quality);
      const audioStream = this.selectBestStream(playStreams.audioStreams, void 0, request.audioQuality);
      if (!videoStream || !audioStream) {
        return this.failResult(DownloadErrorCode.RESOURCE_NOT_FOUND, "\u65E0\u6CD5\u627E\u5230\u5408\u9002\u7684\u89C6\u9891\u6216\u97F3\u9891\u6D41", startTime);
      }
      const plan = {
        bvid: parseResult.bvid,
        cid,
        title: fullTitle,
        videoStream,
        audioStream,
        outputFileName: this.buildFileName(fullTitle, request.fileNameTemplate ?? "{title}")
      };
      const outputFile = (0, import_node_path.join)(request.outputDir, `${plan.outputFileName}.mp4`);
      const shouldSkip = request.skipExisting ?? true;
      if (shouldSkip && await this.deps.fileStore.exists(outputFile)) {
        const fileSize2 = await this.deps.fileStore.getFileSize(outputFile);
        const result2 = {
          status: TaskStatus.Completed,
          outputFile,
          fileSize: fileSize2,
          errorCode: DownloadErrorCode.UNKNOWN_ERROR,
          errorMessage: "\u6587\u4EF6\u5DF2\u5B58\u5728, \u8DF3\u8FC7\u4E0B\u8F7D",
          timing: { totalMs: Date.now() - startTime, resolveMs, downloadMs: 0, mergeMs: 0 }
        };
        this.emitEvent({
          type: DownloadEventType.TaskCompleted,
          result: result2,
          status: TaskStatus.Completed
        });
        return result2;
      }
      this.emitEvent({
        type: DownloadEventType.TaskResolved,
        request,
        plan,
        status: TaskStatus.Resolving
      });
      this.emitEvent({
        type: DownloadEventType.StreamSelected,
        videoCodec: videoStream.codec,
        videoQuality: String(videoStream.quality),
        audioCodec: audioStream.codec,
        audioQuality: String(audioStream.quality)
      });
      await this.deps.fileStore.ensureOutputDir(request.outputDir);
      tempDir = await this.deps.fileStore.createTempDir();
      const downloadStart = Date.now();
      const videoExt = videoStream.format ?? "m4s";
      const audioExt = audioStream.format ?? "m4s";
      const videoFile = (0, import_node_path.join)(tempDir, `video.${videoExt}`);
      const audioFile = (0, import_node_path.join)(tempDir, `audio.${audioExt}`);
      await this.downloadWithProgress(videoStream.url, videoFile, cookieString);
      await this.downloadWithProgress(audioStream.url, audioFile, cookieString);
      downloadMs = Date.now() - downloadStart;
      this.emitEvent({ type: DownloadEventType.MergeProgress });
      const mergeStart = Date.now();
      await this.deps.mediaMerger.merge(videoFile, audioFile, outputFile);
      mergeMs = Date.now() - mergeStart;
      if (request.downloadSubtitle && this.deps.subtitleProvider) {
        try {
          const subtitles = await this.deps.subtitleProvider.fetchSubtitles(parseResult.bvid, cid, cookieString);
          if (subtitles.length > 0) {
            const { writeFile: writeFile3 } = await import("node:fs/promises");
            for (const sub of subtitles) {
              const srtFile = outputFile.replace(/\.mp4$/, `.${sub.langKey}.srt`);
              await writeFile3(srtFile, sub.srtContent, "utf-8");
            }
          }
        } catch {
        }
      }
      const totalMs = Date.now() - startTime;
      const fileSize = await this.deps.fileStore.getFileSize(outputFile);
      const result = {
        status: TaskStatus.Completed,
        outputFile,
        fileSize,
        timing: { totalMs, resolveMs, downloadMs, mergeMs }
      };
      this.emitEvent({
        type: DownloadEventType.TaskCompleted,
        result,
        status: TaskStatus.Completed
      });
      return result;
    } catch (err) {
      hasFailed = true;
      const errorMessage = err.message;
      return this.failResult(DownloadErrorCode.UNKNOWN_ERROR, errorMessage, startTime);
    } finally {
      if (tempDir) {
        try {
          const keepTemp = hasFailed && (request.keepTempOnFailure ?? false);
          if (!keepTemp) {
            await this.deps.fileStore.cleanTempDir(tempDir);
          }
        } catch {
        }
      }
    }
  }
  /** 取消下载 */
  cancel() {
    this.deps.mediaDownloader.abort();
    this.abortController?.abort();
  }
  // ===== 私有方法 =====
  emitEvent(event) {
    this.emit("event", event);
    this.emit(event.type, event);
  }
  async resolveCookieString(cookieFile) {
    if (!cookieFile || !this.deps.authProvider)
      return void 0;
    try {
      const cookies = await this.deps.authProvider.loadCookies(cookieFile);
      return this.deps.authProvider.toCookieString(cookies);
    } catch {
      return void 0;
    }
  }
  selectBestStream(streams, codecPreference, qualityPreference) {
    if (streams.length === 0)
      return null;
    let candidates = [...streams];
    if (codecPreference) {
      const filtered = candidates.filter((s) => s.codec.toLowerCase().includes(codecPreference.toLowerCase()));
      if (filtered.length > 0)
        candidates = filtered;
    }
    if (qualityPreference) {
      const filtered = candidates.filter((s) => s.quality === qualityPreference);
      if (filtered.length > 0)
        candidates = filtered;
    }
    candidates.sort((a, b) => b.quality - a.quality);
    return candidates[0];
  }
  async downloadWithProgress(url, filePath, cookieString) {
    let lastEmitTime = 0;
    await this.deps.mediaDownloader.download({
      url,
      filePath,
      cookieString,
      referer: "https://www.bilibili.com",
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastEmitTime >= 1e3) {
          lastEmitTime = now;
          this.emitEvent({
            type: DownloadEventType.DownloadProgress,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBytesPerSec: progress.speedBytesPerSec,
            percentage: progress.percentage
          });
        }
      }
    });
  }
  buildFileName(title, template) {
    let name = template.replace("{title}", title);
    name = name.replace(/[<>:"/\\|?*]/g, "_");
    return name;
  }
  failResult(errorCode, errorMessage, startTime) {
    const totalMs = Date.now() - startTime;
    const result = {
      status: TaskStatus.Failed,
      errorCode,
      errorMessage,
      timing: { totalMs, resolveMs: 0, downloadMs: 0, mergeMs: 0 }
    };
    this.emitEvent({
      type: DownloadEventType.TaskFailed,
      result,
      status: TaskStatus.Failed
    });
    return result;
  }
};

// ../core/dist/usecases/DownloadFavoritesUseCase.js
var import_node_events2 = require("node:events");
var import_node_path2 = require("node:path");
var DownloadFavoritesUseCase = class extends import_node_events2.EventEmitter {
  deps;
  constructor(deps) {
    super();
    this.deps = deps;
  }
  async execute(mediaId, baseRequest, cookieString) {
    const startTime = Date.now();
    try {
      console.log("\n=== \u5408\u96C6\u4E0B\u8F7D\u6A21\u5F0F ===");
      const info = await this.deps.favoritesProvider.getFavoritesInfo(mediaId, cookieString);
      console.log(`\u5408\u96C6: ${info.title}`);
      console.log(`\u5171 ${info.mediaCount} \u4E2A\u89C6\u9891
`);
      const allVideos = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await this.deps.favoritesProvider.getFavoritesVideos(mediaId, page, 20, cookieString);
        for (const v of result.videos) {
          allVideos.push({
            bvid: v.bvid,
            title: v.title,
            pageCount: v.pageCount
          });
        }
        hasMore = result.hasMore;
        page++;
      }
      console.log(`\u5DF2\u83B7\u53D6 ${allVideos.length} \u4E2A\u89C6\u9891
`);
      const outputDir = baseRequest.outputDir;
      await this.deps.fileStore.ensureOutputDir(outputDir);
      let completed = 0;
      let failed = 0;
      const singleUseCase = new DownloadSingleVideoUseCase(this.deps);
      singleUseCase.on("event", (event) => {
        this.emit("event", event);
        this.emit(event.type, event);
      });
      for (let i = 0; i < allVideos.length; i++) {
        const video = allVideos[i];
        const idx = i + 1;
        console.log(`[${idx}/${allVideos.length}] ${video.title}`);
        const request = {
          ...baseRequest,
          input: video.bvid,
          outputDir: (0, import_node_path2.join)(outputDir, sanitizeDirName(info.title))
        };
        const result = await singleUseCase.execute(request);
        if (result.status === TaskStatus.Completed) {
          completed++;
          console.log(`  \u2705 \u5B8C\u6210`);
        } else {
          failed++;
          console.log(`  \u274C [${result.errorCode}] ${result.errorMessage}`);
        }
      }
      const totalMs = Date.now() - startTime;
      const finalResult = {
        status: failed === 0 ? TaskStatus.Completed : TaskStatus.Failed,
        timing: { totalMs, resolveMs: 0, downloadMs: 0, mergeMs: 0 }
      };
      console.log(`
\u5408\u96C6\u4E0B\u8F7D\u5B8C\u6210: ${completed} \u6210\u529F / ${failed} \u5931\u8D25 / ${allVideos.length} \u603B\u8BA1`);
      console.log(`\u8017\u65F6: ${formatTime(totalMs)}`);
      console.log(`\u8F93\u51FA\u76EE\u5F55: ${(0, import_node_path2.join)(outputDir, sanitizeDirName(info.title))}`);
      return finalResult;
    } catch (err) {
      return {
        status: TaskStatus.Failed,
        errorCode: DownloadErrorCode.UNKNOWN_ERROR,
        errorMessage: err.message,
        timing: {
          totalMs: Date.now() - startTime,
          resolveMs: 0,
          downloadMs: 0,
          mergeMs: 0
        }
      };
    }
  }
  cancel() {
    this.deps.mediaDownloader.abort();
  }
};
function sanitizeDirName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}
function formatTime(ms) {
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0)
    return `${minutes}\u5206${secs}\u79D2`;
  return `${secs}\u79D2`;
}

// ../core/dist/ports/ResourceParserPort.js
var ResourceType;
(function(ResourceType2) {
  ResourceType2["Video"] = "video";
  ResourceType2["Bangumi"] = "bangumi";
  ResourceType2["Cheese"] = "cheese";
  ResourceType2["Favorites"] = "favorites";
})(ResourceType || (ResourceType = {}));
var ResourceParseError = class extends Error {
  input;
  constructor(message, input) {
    super(message);
    this.input = input;
    this.name = "ResourceParseError";
  }
};

// ../core/dist/ports/MediaDownloaderPort.js
var DownloadError = class extends Error {
  url;
  filePath;
  constructor(message, url, filePath) {
    super(message);
    this.url = url;
    this.filePath = filePath;
    this.name = "DownloadError";
  }
};

// ../core/dist/ports/MediaMergerPort.js
var MergeError = class extends Error {
  videoFile;
  audioFile;
  constructor(message, videoFile, audioFile) {
    super(message);
    this.videoFile = videoFile;
    this.audioFile = audioFile;
    this.name = "MergeError";
  }
};

// ../adapters/dist/bilibili/constants.js
var BV_AV_CONVERT = {
  TABLE: "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF",
  TR: /* @__PURE__ */ new Map(),
  S: [11, 10, 3, 8, 4, 6],
  XOR: 177451812n,
  ADD: 8728348608n
};
for (let i = 0; i < BV_AV_CONVERT.TABLE.length; i++) {
  BV_AV_CONVERT.TR.set(BV_AV_CONVERT.TABLE[i], i);
}
var BILI_API_BASE = "https://api.bilibili.com";
var BILI_WWW_BASE = "https://www.bilibili.com";
var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_UA,
  Referer: `${BILI_WWW_BASE}/`,
  Origin: BILI_WWW_BASE
};

// ../adapters/dist/bilibili/web-client.js
function createBilibiliWebClient(options) {
  let cookieString = options?.cookieString;
  const maxRetries = options?.maxRetries ?? 2;
  function getHeaders(extraCookie) {
    const headers = { ...DEFAULT_HEADERS };
    const effectiveCookie = extraCookie ?? cookieString;
    if (effectiveCookie) {
      headers["Cookie"] = effectiveCookie;
    }
    return headers;
  }
  async function requestWithRetry(url, init, retries) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, init);
        if (!response.ok && i < retries) {
          await sleep(1e3 * (i + 1));
          continue;
        }
        return response;
      } catch (err) {
        if (i >= retries)
          throw err;
        await sleep(1e3 * (i + 1));
      }
    }
    throw new Error(`\u8BF7\u6C42\u5931\u8D25: ${url}`);
  }
  return {
    async requestJson(url, extraCookie) {
      const response = await requestWithRetry(url, { headers: getHeaders(extraCookie) }, maxRetries);
      return response.json();
    },
    async requestText(url, extraCookie) {
      const response = await requestWithRetry(url, { headers: getHeaders(extraCookie) }, maxRetries);
      return response.text();
    },
    async downloadBuffer(url, extraCookie) {
      const response = await requestWithRetry(url, { headers: getHeaders(extraCookie) }, maxRetries);
      return response.arrayBuffer();
    },
    setCookieString(cs) {
      cookieString = cs;
    }
  };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ../adapters/dist/bilibili/resource-parser.js
var BV_REGEX = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
var AV_REGEX = /^[Aa][Vv]\d+$/;
var SS_REGEX = /^[Ss][Ss]\d+$/;
var EP_REGEX = /^[Ee][Pp]\d+$/;
var ML_REGEX = /^[Mm][Ll]\d+$/;
var BilibiliResourceParser = class {
  webClient;
  constructor(webClient) {
    this.webClient = webClient;
  }
  async parse(input) {
    const trimmed = input.trim();
    if (BV_REGEX.test(trimmed)) {
      return { bvid: trimmed, cid: 0, type: ResourceType.Video };
    }
    if (AV_REGEX.test(trimmed.toLowerCase())) {
      const aid = Number.parseInt(trimmed.substring(2), 10);
      const bvid = this.av2bv(aid);
      return { bvid, cid: 0, type: ResourceType.Video };
    }
    if (SS_REGEX.test(trimmed)) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: `https://www.bilibili.com/bangumi/play/${trimmed}`
      };
    }
    if (EP_REGEX.test(trimmed)) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: `https://www.bilibili.com/bangumi/play/${trimmed}`
      };
    }
    if (ML_REGEX.test(trimmed)) {
      const mediaId = Number.parseInt(trimmed.substring(2), 10);
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Favorites,
        mediaId,
        originalUrl: `https://www.bilibili.com/medialist/detail/${trimmed}`
      };
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return this.parseUrl(trimmed);
    }
    throw new ResourceParseError(`\u65E0\u6CD5\u8BC6\u522B\u7684\u8F93\u5165\u683C\u5F0F: "${trimmed}"\u3002\u8BF7\u63D0\u4F9B BV \u53F7\u3001AV \u53F7\u6216 B \u7AD9\u89C6\u9891\u94FE\u63A5`, input);
  }
  async parseUrl(url) {
    let normalized = url.replace(/^http:\/\//, "https://");
    normalized = normalized.split("?")[0];
    normalized = normalized.replace(/\/$/, "");
    if (normalized.includes("b23.tv")) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: DEFAULT_HEADERS
      });
      const location = response.headers.get("location");
      if (location) {
        return this.parseUrl(location);
      }
      throw new ResourceParseError("b23.tv \u77ED\u94FE\u63A5\u91CD\u5B9A\u5411\u5931\u8D25", url);
    }
    const bangumiSsMatch = normalized.match(/\/bangumi\/play\/ss(\d+)/i);
    if (bangumiSsMatch) {
      return {
        bvid: "",
        // 番剧需要后续通过 season API 获取 bvid
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: url
      };
    }
    const bangumiEpMatch = normalized.match(/\/bangumi\/play\/ep(\d+)/i);
    if (bangumiEpMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: url
      };
    }
    const mlDetailMatch = normalized.match(/\/medialist\/detail\/ml(\d+)/i);
    if (mlDetailMatch) {
      const mediaId = Number.parseInt(mlDetailMatch[1], 10);
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Favorites,
        mediaId,
        originalUrl: url
      };
    }
    const mlPlayMatch = normalized.match(/\/medialist\/play\/ml(\d+)/i);
    if (mlPlayMatch) {
      const mediaId = Number.parseInt(mlPlayMatch[1], 10);
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Favorites,
        mediaId,
        originalUrl: url
      };
    }
    const mlListMatch = normalized.match(/\/list\/ml(\d+)/i);
    if (mlListMatch) {
      const mediaId = Number.parseInt(mlListMatch[1], 10);
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Favorites,
        mediaId,
        originalUrl: url
      };
    }
    const cheeseSsMatch = normalized.match(/\/cheese\/play\/ss(\d+)/i);
    if (cheeseSsMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Cheese,
        originalUrl: url
      };
    }
    const cheeseEpMatch = normalized.match(/\/cheese\/play\/ep(\d+)/i);
    if (cheeseEpMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Cheese,
        originalUrl: url
      };
    }
    const bvMatch = normalized.match(/\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i);
    if (bvMatch) {
      return { bvid: bvMatch[1], cid: 0, type: ResourceType.Video };
    }
    const avMatch = normalized.match(/\/video\/[Aa][Vv](\d+)/);
    if (avMatch) {
      const aid = Number.parseInt(avMatch[1], 10);
      const bvid = this.av2bv(aid);
      return { bvid, cid: 0, type: ResourceType.Video };
    }
    throw new ResourceParseError(`\u65E0\u6CD5\u8BC6\u522B\u7684 URL: "${url}"\u3002\u8BF7\u63D0\u4F9B\u6709\u6548\u7684 B \u7AD9\u89C6\u9891\u6216\u756A\u5267\u94FE\u63A5`, url);
  }
  /**
   * AV 号转 BV 号
   *
   * B 站 AV-BV 互转算法: XOR + 58进制固定置换表
   * 参考: downkyicore/DownKyi.Core/BiliApi/BiliUtils/BvId.cs
   */
  av2bv(aid) {
    const { TABLE, S, XOR, ADD } = BV_AV_CONVERT;
    const num = (BigInt(aid) ^ XOR) + ADD;
    const chars = ["B", "V", "1", "", "", "4", "", "", "1", "", "7", ""];
    for (let i = 0; i < 6; i++) {
      const idx = S[i];
      const charIndex = Number(num / 58n ** BigInt(i) % 58n);
      chars[idx] = TABLE[charIndex];
    }
    return chars.join("");
  }
};

// ../adapters/dist/bilibili/wbi-sign.js
var MIXIN_KEY_ENC_TAB = [
  46,
  47,
  18,
  2,
  53,
  8,
  23,
  32,
  15,
  50,
  10,
  31,
  58,
  3,
  45,
  35,
  27,
  43,
  5,
  49,
  33,
  9,
  42,
  19,
  29,
  28,
  14,
  39,
  12,
  38,
  41,
  13,
  37,
  48,
  7,
  16,
  24,
  55,
  40,
  61,
  26,
  17,
  0,
  1,
  60,
  51,
  30,
  4,
  22,
  25,
  54,
  21,
  56,
  59,
  6,
  63,
  57,
  62,
  11,
  36,
  20,
  34,
  44,
  52
];
function getMixinKey(imgKey, subKey) {
  const combined = imgKey + subKey;
  const result = [];
  for (let i = 0; i < 32; i++) {
    result.push(combined[MIXIN_KEY_ENC_TAB[i]]);
  }
  return result.join("");
}
async function wbiSign(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey, subKey);
  const filtered = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== void 0) {
      filtered[k] = String(v);
    }
  }
  filtered["wts"] = String(Math.floor(Date.now() / 1e3));
  const sortedKeys = Object.keys(filtered).sort();
  const queryParts = [];
  for (const key of sortedKeys) {
    const value = filtered[key].replace(/[!'()*]/g, "");
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  const queryString = queryParts.join("&");
  const wrid = await md5(queryString + mixinKey);
  filtered["w_rid"] = wrid;
  return filtered;
}
async function md5(input) {
  if (typeof process !== "undefined") {
    const crypto2 = await import("node:crypto");
    return crypto2.createHash("md5").update(input).digest("hex");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("MD5", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ../adapters/dist/bilibili/stream-provider.js
var API = {
  /** 导航 (获取 WBI Keys) */
  NAV: `${BILI_API_BASE}/x/web-interface/nav`,
  /** 普通视频信息 (WBI 签名) */
  VIDEO_INFO: `${BILI_API_BASE}/x/web-interface/wbi/view`,
  /** 普通视频播放流 (WBI 签名) */
  VIDEO_PLAYURL: `${BILI_API_BASE}/x/player/wbi/playurl`,
  /** 番剧播放流 (无需 WBI) */
  BANGUMI_PLAYURL: `${BILI_API_BASE}/pgc/player/web/playurl`,
  /** 课程播放流 (无需 WBI) */
  CHEESE_PLAYURL: `${BILI_API_BASE}/pugv/player/web/playurl`
};
var DEFAULT_FNVAL = 4048;
var BilibiliStreamProvider = class {
  webClient;
  wbiKeys = null;
  constructor(webClient) {
    this.webClient = webClient;
  }
  /**
   * 初始化 WBI Keys (从 Nav API 获取)
   */
  async initWbiKeys(cookieString) {
    const navData = await this.webClient.requestJson(API.NAV, cookieString);
    const imgUrl = navData.data.wbi_img.img_url;
    const subUrl = navData.data.wbi_img.sub_url;
    this.wbiKeys = {
      imgKey: imgUrl.split("/").pop()?.split(".")[0] ?? "",
      subKey: subUrl.split("/").pop()?.split(".")[0] ?? ""
    };
  }
  async getVideoInfo(bvid) {
    const params = await this.signWbi({ bvid });
    const data = await this.webClient.requestJson(`${API.VIDEO_INFO}?${toQueryString(params)}`);
    if (data.code !== 0) {
      throw new Error(`\u83B7\u53D6\u89C6\u9891\u4FE1\u606F\u5931\u8D25: code=${data.code}`);
    }
    const v = data.data;
    return {
      bvid: v.bvid,
      avid: v.aid,
      title: v.title,
      duration: v.duration,
      coverUrl: v.pic,
      pages: v.pages.map((p) => ({
        cid: p.cid,
        page: p.page,
        title: p.part,
        duration: p.duration
      }))
    };
  }
  async getPlayStreams(input) {
    const cookieString = input.cookieString;
    let data;
    switch (input.resourceType) {
      case ResourceType.Bangumi:
        data = await this.getBangumiPlayUrl(input, cookieString);
        break;
      case ResourceType.Cheese:
        data = await this.getCheesePlayUrl(input, cookieString);
        break;
      case ResourceType.Video:
      default:
        data = await this.getVideoPlayUrl(input, cookieString);
        break;
    }
    if (data.code !== 0) {
      throw new Error(`\u83B7\u53D6\u64AD\u653E\u6D41\u5931\u8D25: code=${data.code}, message=${data.message}`);
    }
    const dash = data.data.dash;
    if (!dash) {
      throw new Error("\u8BE5\u89C6\u9891\u65E0 DASH \u6D41 (\u53EF\u80FD\u662F FLV \u683C\u5F0F)");
    }
    return {
      videoStreams: (dash.video ?? []).map((s) => this.dashToMediaStream(s, "video")),
      audioStreams: (dash.audio ?? []).map((s) => this.dashToMediaStream(s, "audio"))
    };
  }
  // ========== 私有方法 ==========
  /** 普通视频播放流 (WBI 签名) */
  async getVideoPlayUrl(input, cookieString) {
    const params = await this.signWbi({
      bvid: input.bvid,
      cid: input.cid,
      qn: 0,
      // 0 表示返回所有可用清晰度
      fnval: DEFAULT_FNVAL,
      fnver: 0,
      fourk: 1
    });
    return this.webClient.requestJson(`${API.VIDEO_PLAYURL}?${toQueryString(params)}`, cookieString);
  }
  /** 番剧播放流 (无 WBI 签名，直接请求) */
  async getBangumiPlayUrl(input, cookieString) {
    const params = new URLSearchParams({
      bvid: input.bvid,
      cid: String(input.cid),
      qn: "0",
      fnval: String(DEFAULT_FNVAL),
      fnver: "0",
      fourk: "1"
    });
    const url = `${API.BANGUMI_PLAYURL}?${params.toString()}`;
    return this.webClient.requestJson(url, cookieString);
  }
  /** 课程播放流 (无 WBI 签名) */
  async getCheesePlayUrl(input, cookieString) {
    const params = new URLSearchParams({
      bvid: input.bvid,
      cid: String(input.cid),
      qn: "0",
      fnval: String(DEFAULT_FNVAL),
      fnver: "0",
      fourk: "1"
    });
    const url = `${API.CHEESE_PLAYURL}?${params.toString()}`;
    return this.webClient.requestJson(url, cookieString);
  }
  dashToMediaStream(stream, type) {
    const url = stream.baseUrl || stream.base_url || "";
    const mimeType = stream.mimeType || stream.mime_type || "";
    const format = mimeType.split("/")[1] ?? (type === "video" ? "m4s" : "m4a");
    return {
      url,
      codec: stream.codecs || "unknown",
      quality: stream.id,
      format
    };
  }
  async signWbi(params) {
    if (!this.wbiKeys) {
      await this.initWbiKeys();
    }
    if (!this.wbiKeys) {
      throw new Error("\u65E0\u6CD5\u83B7\u53D6 WBI Keys");
    }
    return wbiSign(params, this.wbiKeys.imgKey, this.wbiKeys.subKey);
  }
};
function toQueryString(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// ../adapters/dist/bilibili/bilibili-api.js
function createBilibiliApiAdapter(cookieString) {
  const webClient = createBilibiliWebClient({ cookieString });
  return {
    webClient,
    resourceParser: new BilibiliResourceParser(webClient),
    streamProvider: new BilibiliStreamProvider(webClient)
  };
}

// ../adapters/dist/bilibili/favorites-provider.js
var BilibiliFavoritesProvider = class {
  webClient;
  constructor(webClient) {
    this.webClient = webClient;
  }
  async getFavoritesInfo(mediaId, cookieString) {
    const url = `${BILI_API_BASE}/x/v3/fav/folder/info?media_id=${mediaId}`;
    const response = await this.webClient.requestJson(url, cookieString);
    if (response.code !== 0) {
      throw new Error(`\u83B7\u53D6\u5408\u96C6\u4FE1\u606F\u5931\u8D25: code=${response.code}, ${response.message}`);
    }
    return {
      mediaId: response.data.id,
      title: response.data.title,
      mediaCount: response.data.media_count,
      coverUrl: response.data.cover
    };
  }
  async getFavoritesVideos(mediaId, page, pageSize = 20, cookieString) {
    const url = `${BILI_API_BASE}/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${pageSize}&platform=web`;
    const response = await this.webClient.requestJson(url, cookieString);
    if (response.code !== 0) {
      throw new Error(`\u83B7\u53D6\u5408\u96C6\u89C6\u9891\u5217\u8868\u5931\u8D25: code=${response.code}, ${response.message}`);
    }
    return {
      videos: response.data.medias.map((m) => ({
        bvid: m.bvid,
        avid: m.id,
        title: m.title,
        pageCount: m.page,
        duration: m.duration,
        coverUrl: m.cover
      })),
      hasMore: response.data.has_more
    };
  }
};

// ../adapters/dist/bilibili/subtitle-provider.js
var BilibiliSubtitleProvider = class {
  webClient;
  wbiKeys = null;
  constructor(webClient) {
    this.webClient = webClient;
  }
  async fetchSubtitles(bvid, cid, cookieString) {
    if (!this.wbiKeys) {
      await this.initWbiKeys(cookieString);
    }
    if (!this.wbiKeys) {
      return [];
    }
    const params = await wbiSign({ bvid, cid }, this.wbiKeys.imgKey, this.wbiKeys.subKey);
    const query = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    let playerData;
    try {
      playerData = await this.webClient.requestJson(`${BILI_API_BASE}/x/player/wbi/v2?${query}`, cookieString);
    } catch {
      return [];
    }
    if (playerData.code !== 0 || !playerData.data.subtitle?.subtitles?.length) {
      return [];
    }
    const results = [];
    for (const sub of playerData.data.subtitle.subtitles) {
      try {
        const url = sub.subtitle_url.startsWith("http") ? sub.subtitle_url : `https:${sub.subtitle_url}`;
        const response = await fetch(url, {
          headers: {
            ...DEFAULT_HEADERS,
            ...cookieString ? { Cookie: cookieString } : {}
          }
        });
        const subtitleJson = await response.json();
        const srtContent = jsonToSrt(subtitleJson);
        results.push({
          langKey: sub.lan,
          langName: sub.lan_doc,
          srtContent
        });
      } catch {
      }
    }
    return results;
  }
  async initWbiKeys(cookieString) {
    const navData = await this.webClient.requestJson(`${BILI_API_BASE}/x/web-interface/nav`, cookieString);
    const imgUrl = navData.data.wbi_img.img_url;
    const subUrl = navData.data.wbi_img.sub_url;
    this.wbiKeys = {
      imgKey: imgUrl.split("/").pop()?.split(".")[0] ?? "",
      subKey: subUrl.split("/").pop()?.split(".")[0] ?? ""
    };
  }
};
function jsonToSrt(json) {
  const lines = [];
  for (let i = 0; i < json.body.length; i++) {
    const item = json.body[i];
    lines.push(String(i + 1));
    lines.push(`${secToSrtTime(item.from)} --> ${secToSrtTime(item.to)}`);
    lines.push(item.content);
    lines.push("");
  }
  return lines.join("\n");
}
function secToSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round(seconds % 1 * 1e3);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}

// ../adapters/dist/bilibili-auth/cookie-store.js
var import_promises = require("node:fs/promises");
var import_node_path3 = require("node:path");
var CookieStore = class {
  /**
   * 保存 Cookie 到 JSON 文件
   */
  async save(filePath, cookies) {
    const dir = (0, import_node_path3.dirname)(filePath);
    await (0, import_promises.mkdir)(dir, { recursive: true });
    const data = {
      version: 1,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      cookies
    };
    await (0, import_promises.writeFile)(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
  /**
   * 从 JSON 文件加载 Cookie
   */
  async load(filePath) {
    const content = await (0, import_promises.readFile)(filePath, "utf-8");
    const data = JSON.parse(content);
    if (!data.cookies || !Array.isArray(data.cookies)) {
      throw new Error(`Cookie \u6587\u4EF6\u683C\u5F0F\u65E0\u6548: ${filePath}`);
    }
    return data.cookies;
  }
};

// ../adapters/dist/bilibili-auth/auth-provider.js
var QR_GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
var QR_POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
var BilibiliAuthProvider = class {
  cookieStore = new CookieStore();
  async generateQrCode() {
    const response = await fetch(QR_GENERATE_URL, {
      headers: DEFAULT_HEADERS
    });
    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`\u83B7\u53D6\u4E8C\u7EF4\u7801\u5931\u8D25: ${data.message}`);
    }
    return {
      qrcodeKey: data.data.qrcode_key,
      url: data.data.url
    };
  }
  async pollQrStatus(qrcodeKey) {
    const url = `${QR_POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`;
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS
    });
    const data = await response.json();
    if (data.code !== 0) {
      return { status: "expired", message: data.message || "\u672A\u77E5\u9519\u8BEF" };
    }
    switch (data.data.code) {
      case 86101:
        return { status: "pending" };
      case 86090:
        return { status: "scanned" };
      case 86038:
        return {
          status: "expired",
          message: data.data.message || "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F"
        };
      case 0:
        return {
          status: "confirmed",
          callbackUrl: data.data.url
        };
      default:
        return {
          status: "expired",
          message: `\u672A\u77E5\u72B6\u6001\u7801: ${data.data.code}`
        };
    }
  }
  extractCookies(callbackUrl) {
    const url = new URL(callbackUrl);
    const cookies = [];
    for (const [name, value] of url.searchParams.entries()) {
      if (name === "Expires" || name === "gourl")
        continue;
      cookies.push({
        name,
        value,
        domain: ".bilibili.com",
        path: "/"
      });
    }
    return cookies;
  }
  async saveCookies(cookies, cookieFile) {
    await this.cookieStore.save(cookieFile, cookies);
  }
  async loadCookies(cookieFile) {
    return this.cookieStore.load(cookieFile);
  }
  toCookieString(cookies) {
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }
};

// ../adapters/dist/downloader/http-downloader.js
var import_node_fs = require("node:fs");
var import_promises2 = require("node:stream/promises");
var HttpDownloader = class {
  abortController = null;
  async download(params) {
    this.abortController = new AbortController();
    const headers = { ...DEFAULT_HEADERS };
    if (params.cookieString) {
      headers["Cookie"] = params.cookieString;
    }
    if (params.referer) {
      headers["Referer"] = params.referer;
    }
    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(params.url, {
          headers,
          signal: this.abortController.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
        const reader = response.body?.getReader();
        if (!reader || !response.body) {
          throw new Error("\u54CD\u5E94\u4F53\u4E3A\u7A7A");
        }
        const writeStream = (0, import_node_fs.createWriteStream)(params.filePath);
        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            downloadedBytes += value.length;
            if (!writeStream.write(value)) {
              await new Promise((resolve) => writeStream.once("drain", resolve));
            }
            if (params.onProgress) {
              const now = Date.now();
              const elapsed = (now - lastTime) / 1e3;
              let speedBytesPerSec = 0;
              if (elapsed >= 0.5) {
                speedBytesPerSec = Math.round((downloadedBytes - lastBytes) / elapsed);
                lastTime = now;
                lastBytes = downloadedBytes;
              }
              params.onProgress({
                downloadedBytes,
                totalBytes: contentLength,
                speedBytesPerSec: speedBytesPerSec || 0,
                percentage: contentLength ? Math.round(downloadedBytes / contentLength * 100) : 0
              });
            }
          }
        } finally {
          writeStream.end();
          await (0, import_promises2.finished)(writeStream);
        }
        return params.filePath;
      } catch (err) {
        lastError = err;
        if (err.name === "AbortError") {
          throw new DownloadError("\u4E0B\u8F7D\u5DF2\u53D6\u6D88", params.url, params.filePath);
        }
        if (attempt < maxRetries) {
          await sleep2(2e3 * (attempt + 1));
          continue;
        }
      }
    }
    throw new DownloadError(`\u4E0B\u8F7D\u5931\u8D25 (\u5DF2\u91CD\u8BD5 ${maxRetries} \u6B21): ${lastError?.message}`, params.url, params.filePath);
  }
  abort() {
    this.abortController?.abort();
  }
};
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ../adapters/dist/downloader/aria2-downloader.js
var Aria2Downloader = class {
  rpcUrl;
  secret;
  pollInterval;
  activeGid = null;
  abortController = null;
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl ?? "http://127.0.0.1:6800/jsonrpc";
    this.secret = options.secret;
    this.pollInterval = options.pollInterval ?? 1e3;
  }
  async download(params) {
    this.abortController = new AbortController();
    const headerLines = [];
    if (params.referer) {
      headerLines.push(`Referer: ${params.referer}`);
    }
    if (params.cookieString) {
      headerLines.push(`Cookie: ${params.cookieString}`);
    }
    headerLines.push(`User-Agent: ${DEFAULT_HEADERS["User-Agent"]}`);
    const lastSep = Math.max(params.filePath.lastIndexOf("\\"), params.filePath.lastIndexOf("/"));
    const dir = params.filePath.substring(0, lastSep);
    const out = params.filePath.substring(lastSep + 1);
    const gid = await this.addUri({
      uris: [params.url],
      options: {
        dir,
        out,
        header: headerLines,
        "max-connection-per-server": "16",
        split: "16"
      }
    });
    this.activeGid = gid;
    return new Promise((resolve, reject) => {
      const poll = async () => {
        if (this.abortController?.signal.aborted) {
          try {
            await this.rpcCall("aria2.remove", [gid]);
          } catch {
          }
          reject(new DownloadError("\u4E0B\u8F7D\u5DF2\u53D6\u6D88", params.url, params.filePath));
          return;
        }
        try {
          const status = await this.getStatus(gid);
          if (status.status === "complete") {
            if (params.onProgress) {
              params.onProgress({
                downloadedBytes: Number.parseInt(status.totalLength),
                totalBytes: Number.parseInt(status.totalLength),
                speedBytesPerSec: 0,
                percentage: 100
              });
            }
            resolve(params.filePath);
            return;
          }
          if (status.status === "error" || status.status === "removed") {
            reject(new DownloadError(`aria2 \u4E0B\u8F7D\u5931\u8D25: ${status.errorMessage ?? "\u672A\u77E5\u9519\u8BEF"}`, params.url, params.filePath));
            return;
          }
          if (params.onProgress) {
            const downloaded = Number.parseInt(status.completedLength);
            const total = Number.parseInt(status.totalLength);
            const speed = Number.parseInt(status.downloadSpeed);
            params.onProgress({
              downloadedBytes: downloaded,
              totalBytes: total,
              speedBytesPerSec: speed,
              percentage: total > 0 ? Math.round(downloaded / total * 100) : 0
            });
          }
          setTimeout(poll, this.pollInterval);
        } catch (err) {
          reject(new DownloadError(`aria2 \u72B6\u6001\u67E5\u8BE2\u5931\u8D25: ${err.message}`, params.url, params.filePath));
        }
      };
      poll();
    });
  }
  abort() {
    this.abortController?.abort();
  }
  async addUri(params) {
    return this.rpcCall("aria2.addUri", [
      params.uris,
      params.options ?? {}
    ]);
  }
  async getStatus(gid) {
    return this.rpcCall("aria2.tellStatus", [
      gid,
      ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "errorMessage"]
    ]);
  }
  async rpcCall(method, params) {
    const body = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: this.secret ? [`token:${this.secret}`, ...params] : params
    };
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });
    if (!response.ok) {
      throw new Error(`aria2 RPC \u8BF7\u6C42\u5931\u8D25: HTTP ${response.status}`);
    }
    const result = await response.json();
    if (result.error) {
      throw new Error(`aria2 RPC \u9519\u8BEF: ${result.error.message} (code=${result.error.code})`);
    }
    return result.result;
  }
};

// ../adapters/dist/ffmpeg/ffmpeg-merger.js
var import_node_child_process = require("node:child_process");
var FfmpegMerger = class {
  ffmpegPath;
  constructor(ffmpegPath = "ffmpeg") {
    this.ffmpegPath = ffmpegPath;
  }
  async isAvailable() {
    return new Promise((resolve) => {
      const proc = (0, import_node_child_process.spawn)(this.ffmpegPath, ["-version"], {
        stdio: "ignore"
      });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }
  async merge(videoFile, audioFile, outputFile) {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoFile,
        "-i",
        audioFile,
        "-c",
        "copy",
        // 不重新编码，直接封装
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-y",
        // 覆盖已存在文件
        outputFile
      ];
      let stderr = "";
      const proc = (0, import_node_child_process.spawn)(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "pipe"]
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(outputFile);
        } else {
          reject(new MergeError(`ffmpeg \u5408\u5E76\u5931\u8D25 (exit code ${code}): ${stderr.slice(-500)}`, videoFile, audioFile));
        }
      });
      proc.on("error", (err) => {
        reject(new MergeError(`\u65E0\u6CD5\u542F\u52A8 ffmpeg: ${err.message}\u3002\u8BF7\u786E\u8BA4 ffmpeg \u5DF2\u5B89\u88C5\u5E76\u5728 PATH \u4E2D`, videoFile, audioFile));
      });
    });
  }
};

// ../adapters/dist/fs/node-file-store.js
var import_promises3 = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path4 = require("node:path");
var import_node_crypto = require("node:crypto");
var NodeFileStore = class {
  async ensureOutputDir(outputDir) {
    await (0, import_promises3.mkdir)(outputDir, { recursive: true });
  }
  async createTempDir() {
    const dir = (0, import_node_path4.join)((0, import_node_os.tmpdir)(), `bilibili-downloader-${(0, import_node_crypto.randomUUID)()}`);
    await (0, import_promises3.mkdir)(dir, { recursive: true });
    return dir;
  }
  async cleanTempDir(tempDir) {
    try {
      await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
    } catch {
    }
  }
  async exists(filePath) {
    try {
      await (0, import_promises3.access)(filePath);
      return true;
    } catch {
      return false;
    }
  }
  async getFileSize(filePath) {
    const s = await (0, import_promises3.stat)(filePath);
    return s.size;
  }
};

// ../adapters/dist/logger.js
var import_node_fs2 = require("node:fs");
var import_promises4 = require("node:fs/promises");
var import_node_path5 = require("node:path");
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
var Logger = class {
  stream = null;
  level;
  constructor(options = {}) {
    this.level = options.level ?? LogLevel.INFO;
    if (options.filePath) {
      this.initFile(options.filePath);
    }
  }
  async initFile(filePath) {
    await (0, import_promises4.mkdir)((0, import_node_path5.dirname)(filePath), { recursive: true });
    this.stream = (0, import_node_fs2.createWriteStream)(filePath, { flags: "a" });
  }
  debug(message, ...args) {
    this.log(LogLevel.DEBUG, "DEBUG", message, args);
  }
  info(message, ...args) {
    this.log(LogLevel.INFO, "INFO", message, args);
  }
  warn(message, ...args) {
    this.log(LogLevel.WARN, "WARN", message, args);
  }
  error(message, ...args) {
    this.log(LogLevel.ERROR, "ERROR", message, args);
  }
  log(level, tag, message, args) {
    if (level < this.level)
      return;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const line = args.length > 0 ? `[${timestamp}] [${tag}] ${message} ${args.map((a) => JSON.stringify(a)).join(" ")}` : `[${timestamp}] [${tag}] ${message}`;
    if (level >= LogLevel.WARN) {
      console.error(line);
    } else {
      console.log(line);
    }
    if (this.stream) {
      this.stream.write(line + "\n");
    }
  }
  close() {
    this.stream?.end();
  }
};
var logger = new Logger();

// ../adapters/dist/task-store.js
var import_promises5 = require("node:fs/promises");
var import_node_path6 = require("node:path");
var TaskStore = class {
  filePath;
  cache = null;
  constructor(filePath) {
    this.filePath = filePath;
  }
  async load() {
    try {
      const content = await (0, import_promises5.readFile)(this.filePath, "utf-8");
      const data = JSON.parse(content);
      this.cache = data;
      return data.tasks;
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.error("\u52A0\u8F7D\u4EFB\u52A1\u8BB0\u5F55\u5931\u8D25:", err.message);
      }
      this.cache = { version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), tasks: [] };
      return [];
    }
  }
  async save(record) {
    if (!this.cache)
      await this.load();
    const idx = this.cache.tasks.findIndex((t) => t.id === record.id);
    if (idx >= 0) {
      this.cache.tasks[idx] = record;
    } else {
      this.cache.tasks.push(record);
    }
    this.cache.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await (0, import_promises5.mkdir)((0, import_node_path6.dirname)(this.filePath), { recursive: true });
    await (0, import_promises5.writeFile)(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
    logger.debug("\u4EFB\u52A1\u8BB0\u5F55\u5DF2\u4FDD\u5B58:", record.id);
  }
  async findByStatus(status) {
    if (!this.cache)
      await this.load();
    return this.cache.tasks.filter((t) => t.status === status);
  }
  async findRecent(limit = 10) {
    if (!this.cache)
      await this.load();
    return this.cache.tasks.slice(-limit).reverse();
  }
  async clear() {
    this.cache = { version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), tasks: [] };
    await (0, import_promises5.mkdir)((0, import_node_path6.dirname)(this.filePath), { recursive: true });
    await (0, import_promises5.writeFile)(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }
};

// dist/commands/download.js
var import_node_os2 = require("node:os");
var import_node_path7 = require("node:path");
var import_node_crypto2 = require("node:crypto");
function createDownloadCommand() {
  return new Command("download").alias("dl").description("\u4E0B\u8F7D B \u7AD9\u89C6\u9891 (\u652F\u6301\u5355\u89C6\u9891/\u5408\u96C6)").argument("<input>", "BV/AV/URL/\u5408\u96C6ID(ml\u5F00\u5934)").option("-o, --output <dir>", "\u8F93\u51FA\u76EE\u5F55", "./downloads").option("-q, --quality <qn>", "\u6E05\u6670\u5EA6 (16=360P, 32=480P, 64=720P, 80=1080P, 120=4K)", "80").option("-c, --codec <codec>", "\u89C6\u9891\u7F16\u7801\u504F\u597D (avc/hevc/av1)").option("--cookie-file <path>", "Cookie \u6587\u4EF6\u8DEF\u5F84").option("--keep-temp", "\u5931\u8D25\u65F6\u4FDD\u7559\u4E34\u65F6\u6587\u4EF6", false).option("-p, --page <n>", "\u4E0B\u8F7D\u6307\u5B9A\u5206 P (1-based)", parseInt).option("--all-pages", "\u4E0B\u8F7D\u6240\u6709\u5206 P", false).option("--downloader <type>", "\u4E0B\u8F7D\u5668 (http/aria2)", "http").option("--subtitle", "\u4E0B\u8F7D\u5B57\u5E55 (.srt)", false).option("--no-skip", "\u4E0D\u8DF3\u8FC7\u5DF2\u5B58\u5728\u7684\u6587\u4EF6 (\u5F3A\u5236\u91CD\u65B0\u4E0B\u8F7D)", false).option("--log-file <path>", "\u65E5\u5FD7\u6587\u4EF6\u8DEF\u5F84").option("--task-store <path>", "\u4EFB\u52A1\u8BB0\u5F55\u6587\u4EF6", (0, import_node_path7.join)((0, import_node_os2.homedir)(), ".bilibili-downloader", "tasks.json")).action(async (input, options) => {
    const startTime = Date.now();
    const quality = Number.parseInt(options.quality, 10);
    const log = options.logFile ? new Logger({ filePath: options.logFile }) : void 0;
    const taskStore = new TaskStore(options.taskStore);
    const baseRequest = {
      input,
      outputDir: options.output,
      quality,
      videoCodec: options.codec,
      cookieFile: options.cookieFile,
      keepTempOnFailure: options.keepTemp,
      downloadSubtitle: options.subtitle,
      skipExisting: !options.noSkip
    };
    const authProvider = new BilibiliAuthProvider();
    let cookieString;
    if (options.cookieFile) {
      try {
        const cookies = await authProvider.loadCookies(options.cookieFile);
        cookieString = authProvider.toCookieString(cookies);
        console.log(`\u5DF2\u52A0\u8F7D ${cookies.length} \u4E2A Cookie`);
      } catch (err) {
        console.error(`\u8B66\u544A: \u65E0\u6CD5\u52A0\u8F7D Cookie: ${err.message}`);
      }
    }
    const api = createBilibiliApiAdapter(cookieString);
    const downloader = options.downloader === "aria2" ? new Aria2Downloader() : new HttpDownloader();
    const merger = new FfmpegMerger();
    const fileStore = new NodeFileStore();
    if (!await merger.isAvailable()) {
      console.error("\u9519\u8BEF: ffmpeg \u672A\u5B89\u88C5\u3002\u8BF7\u5B89\u88C5: https://ffmpeg.org/");
      process.exit(1);
    }
    const commonDeps = {
      resourceParser: api.resourceParser,
      streamProvider: api.streamProvider,
      mediaDownloader: downloader,
      mediaMerger: merger,
      fileStore,
      authProvider,
      subtitleProvider: new BilibiliSubtitleProvider(api.webClient)
    };
    const parseResult = await api.resourceParser.parse(input);
    if (parseResult.type === ResourceType.Favorites && parseResult.mediaId) {
      const batchUseCase = new DownloadFavoritesUseCase({
        ...commonDeps,
        favoritesProvider: new BilibiliFavoritesProvider(api.webClient)
      });
      batchUseCase.on(DownloadEventType.DownloadProgress, (event) => {
        const pct = String(event.percentage).padStart(3);
        process.stdout.write(`\r  \u8FDB\u5EA6: ${pct}% | ${formatBytes(event.downloadedBytes)} / ${formatBytes(event.totalBytes)} | ${formatSpeed(event.speedBytesPerSec)}    `);
      });
      process.on("SIGINT", () => {
        console.log("\n  \u6B63\u5728\u53D6\u6D88...");
        batchUseCase.cancel();
      });
      await batchUseCase.execute(parseResult.mediaId, baseRequest, cookieString);
    } else {
      const createListeners = (useCase, label) => {
        useCase.on(DownloadEventType.TaskStarted, () => {
          console.log(`
${label}`);
          if (cookieString)
            console.log("  \u4F7F\u7528\u767B\u5F55 Cookie");
        });
        useCase.on(DownloadEventType.TaskResolved, (event) => {
          console.log(`  \u6807\u9898: ${event.plan.title}`);
        });
        useCase.on(DownloadEventType.StreamSelected, (event) => {
          console.log(`  \u89C6\u9891\u6D41: ${event.videoCodec}`);
          console.log(`  \u97F3\u9891\u6D41: ${event.audioCodec}`);
        });
        useCase.on(DownloadEventType.DownloadProgress, (event) => {
          const pct = String(event.percentage).padStart(3);
          process.stdout.write(`\r  \u8FDB\u5EA6: ${pct}% | ${formatBytes(event.downloadedBytes)} / ${formatBytes(event.totalBytes)} | ${formatSpeed(event.speedBytesPerSec)}    `);
        });
        useCase.on(DownloadEventType.MergeProgress, () => {
          console.log("\n  \u5408\u5E76\u97F3\u89C6\u9891...");
        });
        useCase.on(DownloadEventType.TaskCompleted, (event) => {
          console.log(`
  \u2705 \u5B8C\u6210: ${formatBytes(event.result.fileSize ?? 0)} (${formatTime2(event.result.timing?.totalMs ?? 0)})`);
        });
        useCase.on(DownloadEventType.TaskFailed, (event) => {
          console.log(`
  \u274C \u5931\u8D25: [${event.result.errorCode}] ${event.result.errorMessage}`);
        });
      };
      if (options.allPages) {
        const videoInfo = await api.streamProvider.getVideoInfo(parseResult.bvid);
        const totalPages = videoInfo.pages.length;
        console.log(`
\u591A P \u89C6\u9891: \u5171 ${totalPages} \u4E2A\u5206 P`);
        let completed = 0;
        for (let i = 0; i < totalPages; i++) {
          const pageNum = i + 1;
          const pageName = videoInfo.pages[i].title;
          const label = `[${pageNum}/${totalPages}] ${pageName}`;
          const pageUseCase = new DownloadSingleVideoUseCase(commonDeps);
          createListeners(pageUseCase, label);
          const result = await pageUseCase.execute({
            ...baseRequest,
            page: pageNum
          });
          if (result.status === TaskStatus.Completed)
            completed++;
        }
        console.log(`
\u5168\u90E8\u5206 P \u4E0B\u8F7D\u5B8C\u6210: ${completed}/${totalPages} \u6210\u529F`);
      } else {
        const useCase = new DownloadSingleVideoUseCase(commonDeps);
        createListeners(useCase, `\u5F00\u59CB\u4E0B\u8F7D: ${input}`);
        process.on("SIGINT", () => {
          console.log("\n  \u6B63\u5728\u53D6\u6D88...");
          useCase.cancel();
        });
        const request = options.page ? { ...baseRequest, page: options.page } : baseRequest;
        const result = await useCase.execute(request);
        if (result.status === TaskStatus.Failed)
          process.exit(1);
        await saveTaskRecord(taskStore, {
          request,
          result,
          startTime
        }, log);
      }
    }
  });
}
async function saveTaskRecord(store, info, log) {
  try {
    await store.save({
      id: (0, import_node_crypto2.randomUUID)(),
      request: info.request,
      status: info.result.status,
      outputFile: info.result.outputFile,
      errorMessage: info.result.errorMessage,
      createdAt: new Date(info.startTime).toISOString(),
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: info.result.timing?.totalMs
    });
  } catch (err) {
    log?.error("\u4FDD\u5B58\u4EFB\u52A1\u8BB0\u5F55\u5931\u8D25:", err.message);
  }
}
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}
function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}
function formatTime2(ms) {
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0)
    return `${minutes}\u5206${secs}\u79D2`;
  return `${secs}\u79D2`;
}

// dist/commands/login.js
var import_qrcode_terminal = __toESM(require_main(), 1);
var import_node_os3 = require("node:os");
var import_node_path8 = require("node:path");
var DEFAULT_COOKIE_FILE = (0, import_node_path8.join)((0, import_node_os3.homedir)(), ".bilibili-downloader", "cookies.json");
function createLoginCommand() {
  return new Command("login").description("\u901A\u8FC7\u4E8C\u7EF4\u7801\u767B\u5F55 B \u7AD9\uFF0C\u4FDD\u5B58 Cookie").option("-o, --output <path>", "Cookie \u8F93\u51FA\u6587\u4EF6\u8DEF\u5F84", DEFAULT_COOKIE_FILE).action(async (options) => {
    const { output } = options;
    const auth = new BilibiliAuthProvider();
    try {
      console.log("\u6B63\u5728\u83B7\u53D6\u767B\u5F55\u4E8C\u7EF4\u7801...");
      const qrResult = await auth.generateQrCode();
      console.log("\n\u8BF7\u4F7F\u7528 Bilibili \u624B\u673A\u5BA2\u6237\u7AEF\u626B\u63CF\u4EE5\u4E0B\u4E8C\u7EF4\u7801:\n");
      import_qrcode_terminal.default.generate(qrResult.url, { small: true });
      console.log("\n\u7B49\u5F85\u626B\u7801...");
      const pollInterval = 1500;
      const maxPollTime = 3 * 60 * 1e3;
      const startTime = Date.now();
      while (Date.now() - startTime < maxPollTime) {
        await sleep3(pollInterval);
        const status = await auth.pollQrStatus(qrResult.qrcodeKey);
        switch (status.status) {
          case "pending":
            break;
          case "scanned":
            console.log("  \u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u767B\u5F55...");
            break;
          case "expired":
            console.error(`
\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F: ${status.message}`);
            process.exit(1);
          case "confirmed": {
            const cookies = auth.extractCookies(status.callbackUrl);
            await auth.saveCookies(cookies, output);
            console.log(`
\u767B\u5F55\u6210\u529F! Cookie \u5DF2\u4FDD\u5B58\u5230: ${output}`);
            console.log(`  \u5305\u542B ${cookies.length} \u4E2A Cookie`);
            const keyNames = ["DedeUserID", "SESSDATA", "bili_jct"];
            for (const key of keyNames) {
              const cookie = cookies.find((c) => c.name === key);
              if (cookie) {
                const masked = cookie.value.length > 10 ? cookie.value.slice(0, 6) + "...." : "***";
                console.log(`  ${key}: ${masked}`);
              }
            }
            return;
          }
        }
      }
      console.error("\n\u767B\u5F55\u8D85\u65F6 (3 \u5206\u949F)");
      process.exit(1);
    } catch (err) {
      console.error(`\u767B\u5F55\u5931\u8D25: ${err.message}`);
      process.exit(1);
    }
  });
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// dist/commands/history.js
var import_node_os4 = require("node:os");
var import_node_path9 = require("node:path");
var DEFAULT_STORE = (0, import_node_path9.join)((0, import_node_os4.homedir)(), ".bilibili-downloader", "tasks.json");
function createHistoryCommand() {
  return new Command("history").alias("hist").description("\u67E5\u770B\u4E0B\u8F7D\u5386\u53F2").option("-s, --store <path>", "\u4EFB\u52A1\u8BB0\u5F55\u6587\u4EF6\u8DEF\u5F84", DEFAULT_STORE).option("-n, --limit <n>", "\u663E\u793A\u6700\u8FD1 N \u6761\u8BB0\u5F55", "20").option("--clear", "\u6E05\u7A7A\u5386\u53F2\u8BB0\u5F55", false).action(async (options) => {
    const store = new TaskStore(options.store);
    const limit = Number.parseInt(options.limit, 10);
    if (options.clear) {
      await store.clear();
      console.log("\u5386\u53F2\u8BB0\u5F55\u5DF2\u6E05\u7A7A");
      return;
    }
    const tasks = await store.findRecent(limit);
    if (tasks.length === 0) {
      console.log("\u6682\u65E0\u4E0B\u8F7D\u8BB0\u5F55");
      return;
    }
    console.log(`
\u4E0B\u8F7D\u5386\u53F2 (\u6700\u8FD1 ${tasks.length} \u6761):
`);
    for (const task of tasks) {
      const icon = task.status === "completed" ? "\u2705" : "\u274C";
      const time = task.createdAt.split("T")[0];
      const duration = task.durationMs ? ` (${(task.durationMs / 1e3).toFixed(1)}s)` : "";
      console.log(`${icon} ${time}  ${task.request.input}${duration}`);
      if (task.outputFile) {
        console.log(`   \u2192 ${task.outputFile}`);
      }
      if (task.errorMessage) {
        console.log(`   \u26A0 ${task.errorMessage}`);
      }
    }
  });
}

// dist/commands/install.js
var import_node_child_process2 = require("node:child_process");
var import_node_os5 = require("node:os");
var isWin = (0, import_node_os5.platform)() === "win32";
function createInstallCommand() {
  return new Command("install").description("\u68C0\u67E5\u5E76\u5B89\u88C5\u4F9D\u8D56\u5DE5\u5177 (ffmpeg, aria2)").option("--ffmpeg-only", "\u4EC5\u68C0\u67E5/\u5B89\u88C5 ffmpeg", false).option("--aria2-only", "\u4EC5\u68C0\u67E5/\u5B89\u88C5 aria2", false).action(async (options) => {
    const deps = [];
    if (!options.aria2Only) {
      deps.push({ name: "ffmpeg", cmd: "ffmpeg", wingetId: "Gyan.FFmpeg" });
    }
    if (!options.ffmpegOnly) {
      deps.push({
        name: "aria2",
        cmd: "aria2c",
        wingetId: "aria2.aria2"
      });
    }
    console.log("\u68C0\u67E5\u4F9D\u8D56\u5DE5\u5177...\n");
    for (const dep of deps) {
      const ok = await checkCommand(dep.cmd);
      console.log(`  ${dep.name.padEnd(12)} ${ok ? "\u2705 \u5DF2\u5B89\u88C5" : "\u274C \u672A\u5B89\u88C5"}`);
      if (!ok && isWin) {
        console.log(`    \u6B63\u5728\u901A\u8FC7 winget \u5B89\u88C5...`);
        try {
          (0, import_node_child_process2.execSync)(`winget install --id "${dep.wingetId}" --source winget --accept-package-agreements --silent`, { stdio: "inherit", timeout: 18e4 });
          console.log(`    \u2705 ${dep.name} \u5B89\u88C5\u5B8C\u6210
`);
        } catch {
          console.log(`    \u274C \u5B89\u88C5\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u6267\u884C: winget install --id "${dep.wingetId}"
`);
        }
      } else if (!ok) {
        console.log(`    \u2192 \u8BF7\u4F7F\u7528\u5305\u7BA1\u7406\u5668\u5B89\u88C5 (brew install / apt install)
`);
      }
    }
  });
}
async function checkCommand(cmd) {
  try {
    if (isWin) {
      (0, import_node_child_process2.execSync)(`where.exe ${cmd}`, { stdio: "ignore" });
    } else {
      (0, import_node_child_process2.execSync)(`which ${cmd}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

// dist/index.js
var program2 = new Command();
program2.name("bili-dl").description("Bilibili \u89C6\u9891\u4E0B\u8F7D\u5DE5\u5177 - \u652F\u6301 BV/AV/URL").version("0.0.1");
program2.addCommand(createDownloadCommand());
program2.addCommand(createLoginCommand());
program2.addCommand(createHistoryCommand());
program2.addCommand(createInstallCommand());
program2.parse();
