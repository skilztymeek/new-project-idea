// A quick coding trivia quiz you can run in the terminal

const readline = require("readline");

const questions = [
  {
    q: "What does HTML stand for?",
    options: ["A) Hyper Text Markup Language", "B) Home Tool Markup Language", "C) Hyperlinks Text Mark Language"],
    answer: "a",
  },
  {
    q: "Which symbol is used for comments in JavaScript?",
    options: ["A) #", "B) //", "C) <!-- -->"],
    answer: "b",
  },
  {
    q: "What does CSS stand for?",
    options: ["A) Computer Style Sheets", "B) Cascading Style Sheets", "C) Creative Style System"],
    answer: "b",
  },
  {
    q: "Which command stages all changes in Git?",
    options: ["A) git commit -a", "B) git push .", "C) git add ."],
    answer: "c",
  },
  {
    q: "What is the default branch name in a new GitHub repo?",
    options: ["A) master", "B) main", "C) default"],
    answer: "b",
  },
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let score = 0;
let current = 0;

function askQuestion() {
  if (current >= questions.length) {
    console.log(`\n${"=".repeat(40)}`);
    console.log(`Quiz complete! You scored ${score}/${questions.length}`);
    console.log("=".repeat(40));
    rl.close();
    return;
  }

  const { q, options, answer } = questions[current];
  console.log(`\nQ${current + 1}: ${q}`);
  options.forEach((opt) => console.log(`  ${opt}`));

  rl.question("\nYour answer (a/b/c): ", (input) => {
    if (input.trim().toLowerCase() === answer) {
      console.log("✅ Correct!");
      score++;
    } else {
      console.log(`❌ Nope! The answer was ${answer.toUpperCase()}`);
    }
    current++;
    askQuestion();
  });
}

console.log("=".repeat(40));
console.log("  CODING TRIVIA QUIZ");
console.log("=".repeat(40));
askQuestion();
