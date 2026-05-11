import { NextResponse } from "next/server";

const jokes = [
  { setup: "Why don't scientists trust atoms?", punchline: "Because they make up everything!" },
  { setup: "Why did the scarecrow win an award?", punchline: "He was outstanding in his field!" },
  { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
  { setup: "What do you call a fake noodle?", punchline: "An impasta!" },
  { setup: "Why did the math book look sad?", punchline: "Because it had too many problems!" },
  { setup: "What do you call a can opener that doesn't work?", punchline: "A can't opener!" },
  { setup: "Why do bees have sticky hair?", punchline: "Because they use honeycombs!" },
  { setup: "What do you call a sleeping dinosaur?", punchline: "A dino-snore!" },
  { setup: "Why did the cookie go to the nurse?", punchline: "Because it felt crummy!" },
  { setup: "What do you call a bear with no teeth?", punchline: "A gummy bear!" },
  { setup: "Why did the golfer bring two pairs of pants?", punchline: "In case he got a hole in one!" },
  { setup: "What do you call cheese that isn't yours?", punchline: "Nacho cheese!" },
  { setup: "Why can't you give Elsa a balloon?", punchline: "Because she'll let it go!" },
  { setup: "What do you call a pile of cats?", punchline: "A meow-tain!" },
  { setup: "Why did the stadium get hot after the game?", punchline: "All the fans left!" },
  { setup: "I'm reading a book on anti-gravity", punchline: "It's impossible to put down!" },
  { setup: "Did you hear about the restaurant on the moon?", punchline: "Great food, no atmosphere!" },
  { setup: "What do you call a fish wearing a crown?", punchline: "A king fish!" },
  { setup: "Why did the bicycle fall over?", punchline: "Because it was two-tired!" },
  { setup: "How does a penguin build its house?", punchline: "Igloos it together!" }
];

const fortunes = [
  "The future is as bright as your faith in yourself.",
  "A journey of a thousand miles begins with a single step.",
  "Your creativity will lead you to great success.",
  "Good things come to those who wait, but better things come to those who work for it.",
  "The only way to do great work is to love what you do.",
  "Your determination will open doors you never knew existed.",
  "Innovation distinguishes between a leader and a follower.",
  "The best way to predict the future is to create it.",
  "Every expert was once a beginner.",
  "Your hard work will pay off sooner than you think.",
  "Believe you can and you're halfway there.",
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "The only limit to our realization of tomorrow is our doubts of today.",
  "Don't watch the clock; do what it does. Keep going.",
  "The future belongs to those who believe in the beauty of their dreams."
];

export async function GET() {
  try {
    // Randomly choose between joke and fortune
    const isJoke = Math.random() > 0.3; // 70% jokes, 30% fortunes

    if (isJoke) {
      const joke = jokes[Math.floor(Math.random() * jokes.length)];
      return NextResponse.json({
        success: true,
        type: "joke",
        ...joke
      });
    } else {
      const fortune = fortunes[Math.floor(Math.random() * fortunes.length)];
      return NextResponse.json({
        success: true,
        type: "fortune",
        text: fortune
      });
    }
  } catch (error) {
    console.error("Joke API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch joke", details: String(error) },
      { status: 500 }
    );
  }
}
