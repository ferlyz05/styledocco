(function() {
  var Language, ensureDirectory, exec, file_exists, fs, generateDocumentation, generateReadme, generateSourceHtml, getLanguage, jade, languages, makeDestination, makeSections, marked, optimist, options, parseArgs, path, preProcess, relative_base, trimNewLines, walk, writeFile;

  exec = require('child_process').exec;

  fs = require('fs');

  path = require('path');

  marked = require('marked');

  jade = require('jade');

  optimist = require('optimist');

  walk = require('walk');

  options = optimist.usage('Usage: $0 [options] [INPUT]').describe('name', 'Name of the project').alias('n', 'name').demand('name').describe('out', 'Output directory').alias('o', 'out')["default"]('out', 'docs').demand('_').argv;

  marked.setOptions({
    sanitize: false
  });

  generateDocumentation = function(source, sourceFiles, cb) {
    return fs.readFile(source, "utf-8", function(err, code) {
      var sections;
      if (err) throw err;
      sections = makeSections(getLanguage(source), code);
      generateSourceHtml(source, sourceFiles, sections);
      return cb();
    });
  };

  Language = (function() {

    function Language(symbols, preprocessor) {
      this.symbols = symbols;
      this.preprocessor = preprocessor;
      this.regexs = {};
      if (this.symbols.single) {
        this.regexs.single = new RegExp('^\\s*' + this.symbols.single + '\\s?');
      }
      this.regexs.multi_start = new RegExp(/^[\s]*\/\*[.]*/);
      this.regexs.multi_end = new RegExp(/.*\*\/.*/);
    }

    Language.prototype.checkType = function(str) {
      if (str.match(this.regexs.multi_start)) {
        return 'multistart';
      } else if (str.match(this.regexs.multi_end)) {
        return 'multiend';
      } else if ((this.regexs.single != null) && str.match(this.regexs.single)) {
        return 'single';
      } else {
        return 'code';
      }
    };

    Language.prototype.filter = function(str) {
      var n, re, _ref;
      _ref = this.regexs;
      for (n in _ref) {
        re = _ref[n];
        str = str.replace(re, '');
      }
      return str;
    };

    Language.prototype.compile = function(filename, cb) {
      if (this.preprocessor != null) {
        return exec("" + this.preprocessor.cmd + " " + (this.preprocessor.args.join(' ')) + " " + filename, function(err, stdout, stderr) {
          return cb(err, stdout);
        });
      } else {
        return fs.readFile(filename, 'utf-8', function(err, data) {
          return cb(err, data);
        });
      }
    };

    return Language;

  })();

  languages = {
    '.css': new Language({
      multi: ["/*", "*/"]
    }),
    '.scss': new Language({
      single: '//',
      multi: ["/*", "*/"]
    }, {
      cmd: 'scss',
      args: ['-t', 'compressed']
    }),
    '.sass': new Language({
      single: '//',
      multi: ["/*", "*/"]
    }, {
      cmd: 'sass',
      args: ['-t', 'compressed']
    }),
    '.less': new Language({
      single: '//',
      multi: ["/*", "*/"]
    }, {
      cmd: 'lessc',
      args: ['-x']
    }),
    '.styl': new Language({
      single: '//',
      multi: ["/*", "*/"]
    }, {
      cmd: 'stylus',
      args: ['-c', '<']
    })
  };

  getLanguage = function(source) {
    return languages[path.extname(source)];
  };

  trimNewLines = function(str) {
    return str.replace(/^\n*/, '').replace(/\n*$/, '');
  };

  ensureDirectory = function(dir, cb) {
    return exec("mkdir -p " + dir, function() {
      return cb();
    });
  };

  makeDestination = function(filepath) {
    var base_path;
    base_path = relative_base(filepath);
    return "" + options.out + "/" + base_path + (path.basename(filepath, path.extname(filepath))) + ".html";
  };

  file_exists = function(path) {
    try {
      return fs.lstatSync(path).isFile;
    } catch (ex) {
      return false;
    }
  };

  preProcess = function(filename, cb) {
    var lang;
    lang = getLanguage(filename);
    return lang.compile(filename, cb);
  };

  makeSections = function(lang, data) {
    var code, docs, hasCode, inMulti, line, lines, multiAccum, save, sections, _i, _len;
    lines = data.split('\n');
    sections = [];
    docs = code = multiAccum = '';
    inMulti = false;
    hasCode = false;
    save = function(docs, code) {
      return sections.push({
        docs: marked(trimNewLines(docs)),
        code: trimNewLines(code)
      });
    };
    for (_i = 0, _len = lines.length; _i < _len; _i++) {
      line = lines[_i];
      if (lang.checkType(line) === 'multistart' || inMulti) {
        if (hasCode) {
          save(docs, code);
          docs = code = '';
          hasCode = false;
        }
        inMulti = true;
        multiAccum += line + '\n';
        if (lang.checkType(line) === 'multiend') {
          inMulti = false;
          docs = multiAccum;
          multiAccum = '';
        }
      } else if (lang.checkType(line) === 'single') {
        if (hasCode) {
          hasCode = false;
          save(docs, code);
          docs = code = '';
        }
        docs += lang.filter(line) + '\n';
      } else {
        hasCode = true;
        code += line + '\n';
      }
    }
    save(docs, code);
    return sections;
  };

  generateSourceHtml = function(source, sourceFiles, sections) {
    var dest, templateDir, title;
    templateDir = "" + __dirname + "/../resources/";
    title = path.basename(source);
    dest = makeDestination(source);
    return preProcess(source, function(err, css) {
      if (err != null) throw err;
      return fs.readFile(templateDir + 'docs.jade', 'utf-8', function(err, tmpl) {
        var docTemplate, html;
        docTemplate = jade.compile(tmpl, {
          filename: templateDir + 'docs.jade'
        });
        html = docTemplate({
          title: title,
          project: {
            name: options.name,
            sources: sourceFiles
          },
          sections: sections,
          file_path: source,
          path: path,
          relative_base: relative_base,
          css: css
        });
        console.log("styledocco: " + source + " -> " + dest);
        return writeFile(dest, html);
      });
    });
  };

  generateReadme = function(sourceFiles, cb) {
    var currentDir, dest, getReadme, templateDir;
    templateDir = "" + __dirname + "/../resources/";
    currentDir = "" + (process.cwd()) + "/";
    dest = "" + options.out + "/index.html";
    getReadme = function(cb) {
      return fs.readdir(currentDir, function(err, files) {
        if (err != null) return cb(err);
        files = files.filter(function(file) {
          return file.toLowerCase().match(/^readme/);
        });
        if (files[0] == null) return cb(new Error('No readme found'));
        return fs.readFile(currentDir + files[0], 'utf-8', function(err, content) {
          if ((err != null) || !content.length) return cb(err);
          return cb(null, marked(content), files[0]);
        });
      });
    };
    return getReadme(function(err, content, readmePath) {
      var title;
      if (content == null) {
        content = "<h1>Readme</h1><p>Please add a README file to this project.</p>";
      }
      if (readmePath == null) readmePath = './';
      title = options.name;
      return fs.readFile(templateDir + 'readme.jade', 'utf-8', function(err, tmpl) {
        var html, readmeTemplate;
        readmeTemplate = jade.compile(tmpl, {
          filename: templateDir + 'readme.jade'
        });
        html = readmeTemplate({
          title: title,
          project: {
            name: options.name,
            sources: sourceFiles
          },
          content: content,
          file_path: readmePath,
          path: path,
          relative_base: relative_base
        });
        console.log("styledocco: " + readmePath + " -> " + dest);
        writeFile(dest, html);
        return cb();
      });
    });
  };

  writeFile = function(dest, contents) {
    var target_dir, write_func;
    target_dir = path.dirname(dest);
    write_func = function() {
      return fs.writeFile(dest, contents, function(err) {
        if (err) throw err;
      });
    };
    return fs.stat(target_dir, function(err, stats) {
      if (err && err.code !== 'ENOENT') throw err;
      if (!err) return write_func();
      if (err) {
        return exec("mkdir -p " + target_dir, function(err) {
          if (err) throw err;
          return write_func();
        });
      }
    });
  };

  relative_base = function(filepath) {
    var result;
    result = path.dirname(filepath) + '/';
    if (result === '/' || result === '//') {
      return '';
    } else {
      return result;
    }
  };

  parseArgs = function(cb) {
    var ext, langFilter, roots;
    roots = options._.sort();
    langFilter = (function() {
      var _results;
      _results = [];
      for (ext in languages) {
        _results.push(" -name '*" + ext + "' ");
      }
      return _results;
    })();
    return exec("find " + (roots.join(' ')) + " -type f \\( " + (langFilter.join(' -o ')) + " \\)", function(err, stdout) {
      var sources;
      if (err) throw err;
      sources = stdout.split("\n").filter(function(file) {
        var filename;
        if (file === '') return false;
        filename = path.basename(file);
        if (filename[0] === '.') return false;
        if (filename.match(/^_.*\.s[ac]ss$/)) return false;
        return true;
      });
      console.log("styledocco: Recursively generating docs underneath " + roots + "/");
      return cb(sources, roots);
    });
  };

  parseArgs(function(sourceFiles) {
    return ensureDirectory(options.out, function() {
      return generateReadme(sourceFiles, function() {
        var files, nextFile;
        files = sourceFiles.slice(0, sourceFiles.length + 1 || 9e9);
        nextFile = function() {
          if (files.length) {
            return generateDocumentation(files.shift(), sourceFiles, nextFile);
          }
        };
        return nextFile();
      });
    });
  });

}).call(this);