// Run from the repo root with: node --test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let focused = null;

class FakeElement {
  constructor(id) {
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.disabled = false;
    this.style = {};
    const classes = (this._classes = new Set());
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c)
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes.clear(); v.split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c)); }
  set innerHTML(_) { this.children = []; }
  get firstElementChild() { return this.children[0]; }
  appendChild(el) { this.children.push(el); return el; }
  querySelectorAll() { return this.children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
  focus() { focused = this; }
}

function loadQuiz(random = Math.random) {
  const elements = {};
  const document = {
    getElementById: (id) => (elements[id] ||= new FakeElement(id)),
    createElement: () => new FakeElement()
  };
  const math = Object.create(Math);
  math.random = random;
  const context = { document, Math: math };
  vm.createContext(context);
  vm.runInContext(`${script}\n;this.__quiz = { quizData, get questions() { return questions; } };`, context);
  return { el: elements, quiz: context.__quiz };
}

const originalFor = (quizData, question) => quizData.find((q) => q.question === question);

test("each run shows all 10 questions once and judges remapped answers correctly", () => {
  const { el, quiz } = loadQuiz();
  const snapshot = JSON.stringify(quiz.quizData);
  const seen = new Set();

  for (let i = 0; i < quiz.quizData.length; i++) {
    const original = originalFor(quiz.quizData, el.questionText.textContent);
    assert.ok(original, "displayed question exists in quizData");
    seen.add(original.question);

    const buttons = el.answers.children;
    assert.deepEqual(buttons.map((b) => b.textContent).sort(), [...original.options].sort());

    const correctBtn = buttons.find((b) => b.textContent === original.options[original.answer]);
    correctBtn.click();

    assert.ok(correctBtn.classList.contains("correct-option"));
    assert.ok(el.feedback.classList.contains("correct"));
    assert.equal(el.scoreChip.textContent, `점수 ${i + 1} / 10`);
    assert.equal(focused, el.nextBtn);
    el.nextBtn.click();
  }

  assert.equal(seen.size, 10);
  assert.ok(el.result.classList.contains("show"));
  assert.match(el.resultText.textContent, /최종 점수: 10 \/ 10/);
  assert.equal(JSON.stringify(quiz.quizData), snapshot, "quizData is not mutated");
});

test("wrong answer highlights and names the real correct option", () => {
  const { el, quiz } = loadQuiz();
  const original = originalFor(quiz.quizData, el.questionText.textContent);
  const correctText = original.options[original.answer];
  const buttons = el.answers.children;
  const wrongBtn = buttons.find((b) => b.textContent !== correctText);

  wrongBtn.click();

  assert.ok(wrongBtn.classList.contains("wrong-option"));
  assert.ok(buttons.find((b) => b.textContent === correctText).classList.contains("correct-option"));
  assert.equal(el.feedback.textContent, `❌ 아쉬워요! 정답은 "${correctText}"입니다.`);
  assert.equal(el.scoreChip.textContent, "점수 0 / 10");
});

test("restart reshuffles and resets score, progress and focus", () => {
  let seed = 1;
  const seeded = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const { el, quiz } = loadQuiz(seeded);
  const order = () => quiz.questions.map((q) => q.question + q.options.join("|")).join("\n");
  const first = order();

  for (let i = 0; i < 10; i++) {
    el.answers.children[0].click();
    el.nextBtn.click();
  }
  el.restartBtn.click();

  assert.notEqual(order(), first);
  assert.equal(el.scoreChip.textContent, "점수 0 / 10");
  assert.equal(el.progressText.textContent, "1 / 10 문제");
  assert.equal(focused, el.answers.children[0]);
});

test("question order is not fixed to the original order", () => {
  const originalOrder = loadQuiz().quiz.quizData.map((q) => q.question).join();
  const changed = Array.from({ length: 20 }, () => loadQuiz().quiz.questions)
    .some((qs) => qs.map((q) => q.question).join() !== originalOrder);
  assert.ok(changed);
});
