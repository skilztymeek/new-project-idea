// A simple greeting generator

const greetings = [
  "Hello, world!",
  "Hey there, teammate!",
  "Welcome to the project!",
  "You got it running — nice work!",
  "Git pull successful. High five! 🙌",
];

const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

console.log("=".repeat(40));
console.log(randomGreeting);
console.log("=".repeat(40));
console.log("\nThis project is alive and well.");
console.log("Try editing this file and pushing a change!");
