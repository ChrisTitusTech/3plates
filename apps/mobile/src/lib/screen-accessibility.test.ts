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

    if (fileName === 'progress.tsx') {
      assert.match(sourceFile.getFullText(), /<ScreenHeader title="Progress" \/>/);
    } else {
      assert.ok(pressables.length > 0, `${fileName} should expose at least one interactive control`);
    }

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
  const callbackSource = readFileSync(path.join(process.cwd(), 'app', 'auth', 'callback.tsx'), 'utf8');
  const progressSource = readFileSync(path.join(process.cwd(), 'app', 'progress.tsx'), 'utf8');
  const workoutsSource = readFileSync(path.join(process.cwd(), 'app', 'workouts.tsx'), 'utf8');
  const manualWorkoutSource = readFileSync(path.join(process.cwd(), 'src', 'lib', 'manual-workouts.ts'), 'utf8');
  const screenHeaderSource = readFileSync(path.join(process.cwd(), 'src', 'components', 'ScreenHeader.tsx'), 'utf8');

  assert.doesNotMatch(indexSource, /Notifications/);
  assert.doesNotMatch(indexSource, /\/notifications/);
  assert.equal(collectJsxElements(signInSource, 'Pressable').length, 1);
  assert.equal(collectJsxElements(signInSource, 'TextInput').length, 0);
  assert.match(callbackSource, /router\.replace\('\/progress'\)/);
  assert.match(progressSource, /updateProgress\(nextProgress\)/);
  assert.match(progressSource, /checkedDay/);
  assert.match(progressSource, /<ScreenHeader title="Progress" \/>/);
  assert.doesNotMatch(progressSource, /Save progress/);
  assert.doesNotMatch(progressSource, /Retry pending/);
  assert.doesNotMatch(progressSource, /Pending offline updates/);
  assert.doesNotMatch(progressSource, /Source:/);
  assert.doesNotMatch(progressSource, /TextInput/);
  assert.doesNotMatch(progressSource, /flushPendingMutations/);
  assert.doesNotMatch(progressSource, /getPendingMutationCount/);
  assert.match(progressSource, /selectedDateKey/);
  assert.match(progressSource, /Workout history/);
  assert.match(progressSource, /formatManualWorkoutLine/);
  assert.match(progressSource, /numberOfLines=\{1\}/);
  assert.match(workoutsSource, /<ScreenHeader title="Workouts" \/>/);
  assert.match(workoutsSource, /Manual entry/);
  assert.match(manualWorkoutSource, /Running\/Walking/);
  assert.match(manualWorkoutSource, /Crossfit/);
  assert.match(manualWorkoutSource, /Biking/);
  assert.match(workoutsSource, /Workout date/);
  assert.match(workoutsSource, /Workout distance/);
  assert.match(workoutsSource, /Workout duration/);
  assert.match(workoutsSource, /WOD name\/type/);
  assert.match(workoutsSource, /Workout details/);
  assert.match(workoutsSource, /Rx or scaled/);
  assert.match(workoutsSource, /Workout score/);
  assert.match(screenHeaderSource, /router\.back\(\)/);
  assert.match(screenHeaderSource, /href="\/"/);
  assert.match(screenHeaderSource, /Go back/);
  assert.match(screenHeaderSource, /Go home/);
});
