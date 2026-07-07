import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';

const screenFiles = [
  'index.tsx',
  'sign-in.tsx',
  'progress.tsx',
  'preferences.tsx',
  'workouts.tsx',
] as const;

type JsxElementNode = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function parseScreen(fileName: string) {
  const absolutePath = path.join(process.cwd(), 'app', fileName);
  const sourceText = readFileSync(absolutePath, 'utf8');

  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function getJsxTagName(node: JsxElementNode) {
  if (ts.isIdentifier(node.tagName)) {
    return node.tagName.text;
  }

  if (ts.isPropertyAccessExpression(node.tagName)) {
    return node.tagName.name.text;
  }

  return null;
}

function getJsxAttributeNames(node: JsxElementNode) {
  const attributes = new Set<string>();

  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property) && ts.isIdentifier(property.name)) {
      attributes.add(property.name.text);
    }
  }

  return attributes;
}

function collectJsxElements(sourceFile: ts.SourceFile, tagName: string) {
  const matches: JsxElementNode[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      getJsxTagName(node) === tagName
    ) {
      matches.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matches;
}

function formatLocation(sourceFile: ts.SourceFile, node: ts.Node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
}

test('app screens keep web-compatible scroll containers', () => {
  for (const fileName of screenFiles) {
    const sourceFile = parseScreen(fileName);
    const scrollViews = collectJsxElements(sourceFile, 'ScrollView');

    assert.ok(scrollViews.length > 0, `${fileName} should render inside a ScrollView`);

    for (const scrollView of scrollViews) {
      const attributes = getJsxAttributeNames(scrollView);
      const location = formatLocation(sourceFile, scrollView);

      assert.ok(attributes.has('style'), `${location} ScrollView should set a full-screen style`);
      assert.ok(
        attributes.has('contentContainerStyle'),
        `${location} ScrollView should set a responsive content container`,
      );
    }
  }
});

test('app screens keep accessible interactive controls', () => {
  for (const fileName of screenFiles) {
    const sourceFile = parseScreen(fileName);
    const pressables = collectJsxElements(sourceFile, 'Pressable');

    assert.ok(pressables.length > 0, `${fileName} should expose at least one interactive control`);

    for (const pressable of pressables) {
      const attributes = getJsxAttributeNames(pressable);
      const location = formatLocation(sourceFile, pressable);

      assert.ok(attributes.has('accessibilityRole'), `${location} Pressable should set accessibilityRole`);

      if (attributes.has('disabled')) {
        assert.ok(
          attributes.has('accessibilityState'),
          `${location} disabled Pressable should expose accessibilityState`,
        );
      }
    }

    for (const textInput of collectJsxElements(sourceFile, 'TextInput')) {
      const attributes = getJsxAttributeNames(textInput);
      const location = formatLocation(sourceFile, textInput);

      assert.ok(attributes.has('accessibilityLabel'), `${location} TextInput should set accessibilityLabel`);
    }
  }
});

test('signed-out and dashboard navigation stays minimal', () => {
  const indexSource = readFileSync(path.join(process.cwd(), 'app', 'index.tsx'), 'utf8');
  const signInSource = parseScreen('sign-in.tsx');

  assert.doesNotMatch(indexSource, /Notifications/);
  assert.doesNotMatch(indexSource, /\/notifications/);
  assert.equal(collectJsxElements(signInSource, 'Pressable').length, 1);
  assert.equal(collectJsxElements(signInSource, 'TextInput').length, 0);
});
