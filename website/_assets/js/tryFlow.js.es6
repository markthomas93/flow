//= require codemirror/lib/codemirror
//= require codemirror/addon/lint/lint
//= require codemirror/mode/javascript/javascript
//= require codemirror/mode/xml/xml
//= require codemirror/mode/jsx/jsx
//= require lz-string

import CodeMirror from "codemirror/lib/codemirror"
import LZString from "lz-string"

CodeMirror.defineOption('flow', null, function(editor) {
  editor.performLint();
});

function get(url) {
  return new Promise(function(resolve, reject) {
    var req = new XMLHttpRequest();
    req.open('GET', url);
    req.onload = function() {
      if (req.status == 200) {
        resolve([url, req.response]);
      }
      else {
        reject(Error(req.statusText));
      }
    };
    req.onerror = function() {
      reject(Error("Network Error"));
    };
    req.send();
  });
}

function printError(err, editor) {
  const clickHandler = (msg) => {
    editor.getDoc().setSelection(
      {line: msg.loc.start.line - 1, ch: msg.loc.start.column - 1},
      {line: msg.loc.end.line - 1, ch: msg.loc.end.column}
    );
    editor.focus();
  };

  return err.message.reduce((container, msg) => {
    if (msg.loc && msg.context != null) {
      const div = document.createElement('div');
      const filename = msg.loc.source !== '-' ? `${msg.loc.source}:` : '';
      const prefix = `${filename}${msg.loc.start.line}: `;

      const before = msg.context.slice(0, msg.loc.start.column - 1);
      const highlight = (msg.loc.start.line === msg.loc.end.line) ?
        msg.context.slice(msg.loc.start.column - 1, msg.loc.end.column) :
        msg.context.slice(msg.loc.start.column - 1);
      const after = (msg.loc.start.line === msg.loc.end.line) ?
        msg.context.slice(msg.loc.end.column) :
        '';
      div.appendChild(document.createTextNode(prefix + before));
      const bold = document.createElement('strong');
      bold.className = "msgHighlight";
      bold.appendChild(document.createTextNode(highlight));
      div.appendChild(bold);
      div.appendChild(document.createTextNode(after));
      container.appendChild(div);

      const offset = msg.loc.start.column + prefix.length - 1;
      const arrow = `${(prefix + before).replace(/[^ ]/g, ' ')}^ `;
      container.appendChild(document.createTextNode(arrow));

      const span = document.createElement('span');
      span.className = "msgType";
      span.appendChild(document.createTextNode(msg.descr));
      container.appendChild(span);

      const handler = clickHandler.bind(null, msg);
      bold.addEventListener('click', handler);
      span.addEventListener('click', handler);
    } else {
      const descr = `. ${msg.descr}\n`;
      container.appendChild(document.createTextNode(descr));
    }
    return container;
  }, document.createElement('li'));
}

function printErrors(errors, editor) {
  if (errors.length == 0) {
    return document.createTextNode('No errors!');
  }
  return errors.reduce((list, err) => {
    list.appendChild(printError(err, editor));
    return list;
  }, document.createElement('ul'));
}

function removeChildren(node) {
  while (node.lastChild) node.removeChild(node.lastChild);
}

function getAnnotations(text, callback, options, editor) {
  const errorsNode = options.errorsNode;
  const jsonNode = options.jsonNode;
  const flowReady = editor.getOption('flow');
  flowReady.then(function(flow) {
    var errors = flow.checkContent('-', text);

    if (errorsNode) {
      removeChildren(errorsNode);
      errorsNode.appendChild(printErrors(errors, editor));
    }

    if (jsonNode) {
      removeChildren(jsonNode);
      jsonNode.appendChild(
        document.createTextNode(JSON.stringify(errors, null, 2))
      );
    }

    var lint = errors.map(function(err) {
      var messages = err.message;
      var firstLoc = messages[0].loc;
      var message = messages.map(function(msg) {
        return msg.descr;
      }).join("\n");
      return {
        from: CodeMirror.Pos(
          firstLoc.start.line - 1,
          firstLoc.start.column - 1
        ),
        to: CodeMirror.Pos(firstLoc.end.line - 1, firstLoc.end.column),
        severity: err.level,
        message: message
      };
    });
    callback(lint);
  });
}
getAnnotations.async = true;

const lastEditorValue = localStorage.getItem('tryFlowLastContent');
const defaultValue = (lastEditorValue && getHashedValue(lastEditorValue)) || `/* @flow */

function foo(x: ?number): string {
  if (x) {
    return x;
  }
  return "default string";
}
`;

function getHashedValue(hash) {
  if (hash[0] !== '#' || hash.length < 2) return null;
  const version = hash.slice(1, 2);
  const encoded = hash.slice(2);
  if (version === '0' && encoded.match(/^[a-zA-Z0-9+/=_-]+$/)) {
    return LZString.decompressFromEncodedURIComponent(encoded);
  }
  return null;
}

function removeClass(elem, className) {
  elem.className = elem.className.split(/\s+/).filter(function(name) {
    return name !== className;
  }).join(' ');
}

const versionCache = {};
function initFlow(version) {
  if (version in versionCache) {
    return Promise.resolve(versionCache[version]);
  }
  const libs = [
    `/static/${version}/flowlib/core.js`,
    `/static/${version}/flowlib/bom.js`,
    `/static/${version}/flowlib/cssom.js`,
    `/static/${version}/flowlib/dom.js`,
    `/static/${version}/flowlib/node.js`,
    `/static/${version}/flowlib/react.js`,
  ];
  const flow = new Promise(function(resolve) {
    require([`${version}/flow`], resolve);
  });
  return Promise.all([flow, ...libs.map(get)])
    .then(function([flow, ...contents]) {
      contents.forEach(function(nameAndContent) {
        flow.registerFile(nameAndContent[0], nameAndContent[1]);
      });
      flow.setLibs(libs);
      versionCache[version] = flow;
      return flow;
    });
}

exports.createEditor = function createEditor(
  flowVersion,
  domNode,
  resultsNode,
  flowVersions
) {
  const flowReady = initFlow(flowVersion);

  require([
    'codemirror/addon/lint/lint',
    'codemirror/mode/javascript/javascript',
    'codemirror/mode/xml/xml',
    'codemirror/mode/jsx/jsx'
  ], function() {
    const location = window.location;

    flowReady.then(function() {
      removeClass(resultsNode, 'show-loading');
    });

    const errorsTabNode = document.createElement('li');
    errorsTabNode.className = "tab errors-tab";
    errorsTabNode.appendChild(document.createTextNode('Errors'));
    errorsTabNode.addEventListener('click', function(evt) {
      removeClass(resultsNode, 'show-json');
      resultsNode.className += ' show-errors';
      evt.kill();
    });

    const jsonTabNode = document.createElement('li');
    jsonTabNode.className = "tab json-tab";
    jsonTabNode.appendChild(document.createTextNode('JSON'));
    jsonTabNode.addEventListener('click', function(evt) {
      removeClass(resultsNode, 'show-errors');
      resultsNode.className += ' show-json';
      evt.kill();
    });

    const versionSelector = document.createElement('select');
    flowVersions.forEach(
      function(version) {
        const option = document.createElement('option');
        option.value = version;
        option.text = version;
        option.selected = version == flowVersion;
        versionSelector.add(option, null);
      }
    );
    const versionTabNode = document.createElement('li');
    versionTabNode.className = "version";
    versionTabNode.appendChild(versionSelector);

    const toolbarNode = document.createElement('ul');
    toolbarNode.className = "toolbar";
    toolbarNode.appendChild(errorsTabNode);
    toolbarNode.appendChild(jsonTabNode);
    toolbarNode.appendChild(versionTabNode);

    const errorsNode = document.createElement('pre');
    errorsNode.className = "errors";

    const jsonNode = document.createElement('pre');
    jsonNode.className = "json";

    resultsNode.appendChild(toolbarNode);
    resultsNode.appendChild(errorsNode);
    resultsNode.appendChild(jsonNode);

    resultsNode.className += " show-errors";

    const editor = CodeMirror(domNode, {
      value: getHashedValue(location.hash) || defaultValue,
      autofocus: true,
      lineNumbers: true,
      mode: "jsx",
      flow: flowReady,
      lint: { getAnnotations, errorsNode, jsonNode }
    });

    editor.on('changes', () => {
      const value = editor.getValue();
      const encoded = LZString.compressToEncodedURIComponent(value);
      history.replaceState(undefined, undefined, `#0${encoded}`);
      localStorage.setItem('tryFlowLastContent', location.hash);
    });

    versionTabNode.addEventListener('change', function(evt) {
      const version = evt.target.value;
      resultsNode.className += ' show-loading';
      const flowReady = initFlow(version);
      flowReady.then(function() {
        removeClass(resultsNode, 'show-loading');
      });
      editor.setOption('flow', flowReady);
    });
  });
}
