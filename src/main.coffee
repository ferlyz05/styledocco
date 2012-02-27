# Dependencies
# ============

{exec} = require 'child_process'
fs     = require 'fs'
path   = require 'path'

marked   = require 'marked'
jade     = require 'jade'
optimist = require 'optimist'
walk     = require 'walk'


# Configuration
# =============

options = optimist
  .usage('Usage: $0 [options] [INPUT]')
  .describe('name', 'Name of the project')
  .alias('n', 'name')
  .demand('name')
  .describe('out', 'Output directory')
  .alias('o', 'out')
  .default('out', 'docs')
  .demand('_')
  .argv

marked.setOptions sanitize: false


# Generate the documentation for a source file by reading it in, splitting it
# up into comment/code sections, and passing them to a Jade template.
generateDocumentation = (source, sourceFiles, cb) ->
  fs.readFile source, "utf-8", (err, code) ->
    throw err if err
    sections = makeSections getLanguage(source), code
    generateSourceHtml source, sourceFiles, sections
    cb()


class Language

  constructor: (@symbols, @preprocessor) ->
    @regexs = {}
    @regexs.single = new RegExp('^\\s*' + @symbols.single + '\\s?') if @symbols.single
    # Hard coded /* */ for now
    @regexs.multi_start = new RegExp(/^[\s]*\/\*[.]*/)
    @regexs.multi_end = new RegExp(/.*\*\/.*/)

  # Check type of string
  checkType: (str) ->
    if str.match @regexs.multi_start
      'multistart'
    else if str.match @regexs.multi_end
      'multiend'
    else if @regexs.single? and str.match @regexs.single
      'single'
    else
      'code'

  # Filter out comment symbols
  filter: (str) ->
    for n, re of @regexs
      str = str.replace re, ''
    str

  compile: (filename, cb) ->
    if @preprocessor?
      exec "#{@preprocessor.cmd} #{@preprocessor.args.join(' ')} #{filename}", (err, stdout, stderr) ->
        cb err, stdout
    else
      fs.readFile filename, 'utf-8', (err, data) ->
        cb err, data


# A list of the supported stylesheet languages and their comment symbols
# and optional preprocessor command.
languages =
  '.css':  new Language({ multi: [ "/*", "*/" ] })
  '.scss': new Language({ single: '//', multi: [ "/*", "*/" ] },
                        { cmd: 'scss', args: [ '-t', 'compressed' ] })
  '.sass': new Language({ single: '//', multi: [ "/*", "*/" ] },
                        { cmd: 'sass', args: [ '-t', 'compressed' ] })
  '.less': new Language({ single: '//', multi: [ "/*", "*/" ] },
                        { cmd: 'lessc', args: [ '-x' ] })
  '.styl': new Language({ single: '//', multi: [ "/*", "*/" ] },
                        { cmd: 'stylus', args: [ '-c', '<' ] })


# Get the language object from a file name.
getLanguage = (source) -> languages[path.extname(source)]


# Helper functions and utilities
# ==============================

trimNewLines = (str) -> str.replace(/^\n*/, '').replace(/\n*$/, '')

ensureDirectory = (dir, cb) -> exec "mkdir -p #{dir}", -> cb()


# File system utils
# -----------------

# Compute the destination HTML path for an input source file path. If the
# source is `src/main.css`, the HTML will be at `docs/src/main.html`.
makeDestination = (filepath) ->
  base_path = relative_base filepath
  "#{options.out}/#{base_path}#{path.basename(filepath, path.extname(filepath))}.html"

file_exists = (path) ->
  try
    return fs.lstatSync(path).isFile
  catch ex
    return false

# Run `filename` through suitable CSS preprocessor.
preProcess = (filename, cb) ->
  lang = getLanguage filename
  lang.compile filename, cb


# Given a string of source code, find each comment and the code that
# follows it, and create an individual **section** for the code/doc pair.
#
# TODO: This stuff comes straight from docco-husky and needs some refactoring.
makeSections = (lang, data) ->
  
  lines = data.split '\n'
  
  sections = []
  docs = code = multiAccum = ''
  inMulti = no
  hasCode = no

  save = (docs, code) ->
    sections.push
      docs: marked trimNewLines(docs)
      code: trimNewLines(code)

  for line in lines

    # Multi line comment
    if lang.checkType(line) is 'multistart' or inMulti

      ## Start of a new section, save the old section
      if hasCode
        save docs, code
        docs = code = ''
        hasCode = no

      # Found the start of a multiline comment.
      # Begin accumulating lines until we reach the end of the comment block.
      inMulti = yes
      multiAccum += line + '\n'

      # If we reached the end of a multiline comment,
      # set inMulti to false and reset multiAccum
      if lang.checkType(line) is 'multiend'
        inMulti = no
        docs = multiAccum
        multiAccum = ''

    # Single line comment
    else if lang.checkType(line) is 'single'
      if hasCode
        hasCode = no
        save docs, code
        docs = code = ''
      docs += lang.filter(line) + '\n'

    # Code
    else
      hasCode = yes
      code += line + '\n'

  # Save final code section
  save docs, code

  sections



# Generate the HTML document and write to file.
# TODO: split up, make async.
generateSourceHtml = (source, sourceFiles, sections) ->
  templateDir = "#{__dirname}/../resources/"
  title = path.basename source
  dest  = makeDestination source

  preProcess source, (err, css) ->
    throw err if err?
    
    fs.readFile templateDir + 'docs.jade', 'utf-8', (err, tmpl) ->
      docTemplate = jade.compile tmpl, filename: templateDir + 'docs.jade'
      html = docTemplate { title, project: { name: options.name, sources: sourceFiles }, sections, file_path: source, path, relative_base, css }

      console.log "styledocco: #{source} -> #{dest}"
      writeFile(dest, html)


# Look for a README file and generate an index.html.
generateReadme = (sourceFiles, cb) ->
  templateDir = "#{__dirname}/../resources/"
  currentDir = "#{process.cwd()}/"
  dest = "#{options.out}/index.html"

  getReadme = (cb) ->
    # Look for readme in current dir
    fs.readdir currentDir, (err, files) ->
      return cb err if err?
      files = files.filter (file) ->
        file.toLowerCase().match /^readme/
      return cb new Error('No readme found') unless files[0]?

      fs.readFile currentDir + files[0], 'utf-8', (err, content) ->
        return cb err if err? or not content.length
        # Callback with parsed markdown and filename
        cb null, marked(content), files[0]


  getReadme (err, content, readmePath) ->
    content ?= "<h1>Readme</h1><p>Please add a README file to this project.</p>"
    readmePath ?= './'
    title = options.name

    # Template to use to generate the documentation index file
    fs.readFile templateDir + 'readme.jade', 'utf-8', (err, tmpl) ->
      readmeTemplate = jade.compile tmpl, filename: templateDir + 'readme.jade'
      html = readmeTemplate { title, project: { name: options.name, sources: sourceFiles }, content, file_path: readmePath, path, relative_base }

      console.log "styledocco: #{readmePath} -> #{dest}"
      writeFile(dest, html)
      cb()


# Write a file to the filesystem
writeFile = (dest, contents) ->

  target_dir = path.dirname(dest)
  write_func = ->
    fs.writeFile dest, contents, (err) -> throw err if err

  fs.stat target_dir, (err, stats) ->
    throw err if err and err.code != 'ENOENT'

    return write_func() unless err

    if err
      exec "mkdir -p #{target_dir}", (err) ->
        throw err if err
        write_func()

# Compute the path of a source file relative to the docs folder
relative_base = (filepath) ->
  result = path.dirname(filepath) + '/'
  if result == '/' or result == '//' then '' else result


# Process our arguments, passing an array of sources to generate docs for,
# and an optional relative root.
parseArgs = (cb) ->

  # Sort the list of files and directories.
  roots = options._.sort()

  # Build an array of `find` options, including only files in our
  # supported languages.
  langFilter = for ext of languages
    " -name '*#{ext}' "

  # TODO: Replace with `walk`.
  exec "find #{roots.join(' ')} -type f \\( #{langFilter.join(' -o ')} \\)", (err, stdout) ->
    throw err if err

    sources = stdout.split("\n").filter (file) ->
      return false if file is ''
      filename = path.basename file
      # Ignore hidden files
      return false if filename[0] is '.'
      # Ignore SASS partials
      return false if filename.match /^_.*\.s[ac]ss$/
      true

    console.log "styledocco: Recursively generating docs underneath #{roots}/"

    cb sources, roots

parseArgs (sourceFiles) ->
  ensureDirectory options.out, ->
    generateReadme sourceFiles, ->
      files = sourceFiles[0..sourceFiles.length]
      nextFile = ->
        if files.length
          generateDocumentation files.shift(), sourceFiles, nextFile
      nextFile()