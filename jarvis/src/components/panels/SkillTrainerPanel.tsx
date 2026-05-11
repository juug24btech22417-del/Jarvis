"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  ChevronRight,
  Play,
  CheckCircle,
  Award,
  BookOpen,
  Target,
  Loader2,
} from "lucide-react";

interface Lesson {
  day: number;
  title: string;
  content: string;
  exercises: string[];
}

interface LearningPlan {
  topic: string;
  difficulty: string;
  duration: string;
  lessons: Lesson[];
}

interface Quiz {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export default function SkillTrainerPanel() {
  const [activeTab, setActiveTab] = useState<"plan" | "learn" | "quiz">("plan");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("beginner");
  const [duration, setDuration] = useState(7);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [currentDay, setCurrentDay] = useState(1);
  const [quiz, setQuiz] = useState<Quiz[] | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);

  const createPlan = useCallback(async () => {
    if (!topic) return;
    setLoading(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          topic,
          difficulty,
          durationDays: duration,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPlan(data.plan);
        setActiveTab("learn");
        setCurrentDay(1);
      }
    } catch (err) {
      console.error("Failed to create plan:", err);
    } finally {
      setLoading(false);
    }
  }, [topic, difficulty, duration]);

  const generateQuiz = useCallback(async () => {
    if (!plan) return;
    setLoading(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quiz",
          topic: plan.topic,
          lesson: plan.lessons[currentDay - 1]?.title || plan.topic,
          numQuestions: 5,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setQuiz(data.quiz);
        setQuizAnswers({});
        setShowQuizResults(false);
        setActiveTab("quiz");
      }
    } catch (err) {
      console.error("Failed to generate quiz:", err);
    } finally {
      setLoading(false);
    }
  }, [plan, currentDay]);

  const submitQuiz = useCallback(() => {
    setShowQuizResults(true);
  }, []);

  const getQuizScore = () => {
    if (!quiz) return 0;
    let correct = 0;
    quiz.forEach((q, idx) => {
      if (quizAnswers[idx] === q.correctAnswer) correct++;
    });
    return Math.round((correct / quiz.length) * 100);
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-2xl border border-cyan-500/30 overflow-hidden">
      
      <div className="p-4 border-b border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-cyan-400">Skill Trainer</h3>
            <p className="text-xs text-cyan-400/60">AI-Powered Learning</p>
          </div>
        </div>
        {plan && (
          <div className="flex gap-2">
            {[
              { id: "learn", icon: BookOpen, label: "Learn" },
              { id: "quiz", icon: Target, label: "Quiz" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "learn" | "quiz")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  activeTab === tab.id
                    ? "bg-cyan-500 text-white"
                    : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      
      <div className="flex-1 overflow-auto p-4">
        <AnimatePresence mode="wait">
          {!plan ? (
            
            <motion.div
              key="create"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div className="text-center mb-6">
                <Brain className="w-16 h-16 text-cyan-400 mx-auto mb-3" />
                <h4 className="text-xl font-bold text-white mb-2">Create Learning Plan</h4>
                <p className="text-cyan-400/60 text-sm">
                  AI will create a personalized curriculum for any topic
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-cyan-400 text-sm font-medium mb-2 block">
                    What do you want to learn?
                  </label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g., Python programming, Spanish, Digital Marketing"
                    className="w-full px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-white placeholder-cyan-400/40 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-cyan-400 text-sm font-medium mb-2 block">
                      Difficulty
                    </label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="w-full px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-white focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-cyan-400 text-sm font-medium mb-2 block">
                      Duration (days)
                    </label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="w-full px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-white focus:border-cyan-400 focus:outline-none"
                    >
                      {[3, 7, 14, 21, 30].map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={createPlan}
                  disabled={loading || !topic}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating Plan...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" />
                      Start Learning
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ) : activeTab === "learn" ? (
            
            <motion.div
              key="learn"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              
              <div className="bg-cyan-500/10 rounded-xl p-4 border border-cyan-500/20">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-lg font-bold text-white mb-1">{plan.topic}</h4>
                    <div className="flex gap-3 text-sm">
                      <span className="text-cyan-400">
                        Difficulty: {plan.difficulty}
                      </span>
                      <span className="text-cyan-400/60">•</span>
                      <span className="text-cyan-400">{plan.duration}</span>
                    </div>
                  </div>
                  <button
                    onClick={generateQuiz}
                    disabled={loading}
                    className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Target className="w-4 h-4" />
                        Take Quiz
                      </>
                    )}
                  </button>
                </div>

                
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-cyan-400/60 mb-1">
                    <span>Progress</span>
                    <span>{Math.round(((currentDay - 1) / plan.lessons.length) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-cyan-500/20 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      initial={{ width: 0 }}
                      animate={{
                        width: `${((currentDay - 1) / plan.lessons.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              
              <div className="flex gap-2 overflow-x-auto pb-2">
                {plan.lessons.map((lesson) => (
                  <button
                    key={lesson.day}
                    onClick={() => setCurrentDay(lesson.day)}
                    className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-bold transition-all ${
                      currentDay === lesson.day
                        ? "bg-cyan-500 text-white"
                        : lesson.day < currentDay
                        ? "bg-green-500/20 text-green-400"
                        : "bg-cyan-500/10 text-cyan-400/60"
                    }`}
                  >
                    {lesson.day < currentDay ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      lesson.day
                    )}
                  </button>
                ))}
              </div>

              
              {plan.lessons[currentDay - 1] && (
                <div className="bg-cyan-500/5 rounded-xl p-5 border border-cyan-500/20">
                  <div className="flex items-center gap-3 mb-4">
                    <BookOpen className="w-5 h-5 text-cyan-400" />
                    <h5 className="text-lg font-bold text-white">
                      {plan.lessons[currentDay - 1].title}
                    </h5>
                  </div>

                  <p className="text-cyan-100/80 leading-relaxed mb-6">
                    {plan.lessons[currentDay - 1].content}
                  </p>

                  <div className="bg-cyan-500/10 rounded-lg p-4">
                    <h6 className="text-sm font-medium text-cyan-400 mb-3">
                      Exercises
                    </h6>
                    <ul className="space-y-2">
                      {plan.lessons[currentDay - 1].exercises.map((exercise, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <ChevronRight className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                          <span className="text-sm text-cyan-100/70">{exercise}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex gap-3 mt-6">
                    {currentDay > 1 && (
                      <button
                        onClick={() => setCurrentDay(currentDay - 1)}
                        className="px-4 py-2 bg-cyan-500/10 text-cyan-400 rounded-lg text-sm font-medium hover:bg-cyan-500/20 transition-all"
                      >
                        Previous Day
                      </button>
                    )}
                    {currentDay < plan.lessons.length ? (
                      <button
                        onClick={() => setCurrentDay(currentDay + 1)}
                        className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg text-sm font-medium hover:bg-cyan-400 transition-all"
                      >
                        Next Day
                      </button>
                    ) : (
                      <button
                        onClick={generateQuiz}
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                      >
                        <Award className="w-4 h-4" />
                        Complete & Take Quiz
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            
            <motion.div
              key="quiz"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {!quiz ? (
                <div className="text-center py-12">
                  <Target className="w-16 h-16 text-cyan-400/40 mx-auto mb-4" />
                  <p className="text-cyan-400/60">
                    Generate a quiz to test your knowledge
                  </p>
                </div>
              ) : showQuizResults ? (
                <div className="bg-cyan-500/10 rounded-xl p-6 border border-cyan-500/20 text-center"
                >
                  <Award className="w-16 h-16 text-cyan-400 mx-auto mb-4" />
                  <h4 className="text-2xl font-bold text-white mb-2">
                    Quiz Complete!
                  </h4>
                  <div className="text-4xl font-bold text-cyan-400 mb-4">
                    {getQuizScore()}%
                  </div>
                  <p className="text-cyan-400/60 mb-6">
                    {getQuizScore() >= 80
                      ? "Excellent work! You're mastering this topic."
                      : getQuizScore() >= 60
                      ? "Good job! Keep practicing to improve."
                      : "Keep learning! Review the lessons and try again."}
                  </p>
                  <button
                    onClick={() => {
                      setShowQuizResults(false);
                      setQuizAnswers({});
                    }}
                    className="px-6 py-2 bg-cyan-500 text-white rounded-lg font-medium"
                  >
                    Retake Quiz
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-bold text-white">Knowledge Quiz</h4>
                    <span className="text-sm text-cyan-400">
                      {Object.keys(quizAnswers).length} / {quiz.length}
                    </span>
                  </div>

                  {quiz.map((q, idx) => (
                    <div
                      key={idx}
                      className="bg-cyan-500/5 rounded-xl p-4 border border-cyan-500/20"
                    >
                      <p className="text-white font-medium mb-4">
                        {idx + 1}. {q.question}
                      </p>

                      <div className="space-y-2">
                        {q.options.map((option, optIdx) => (
                          <button
                            key={optIdx}
                            onClick={() =>
                              setQuizAnswers({ ...quizAnswers, [idx]: optIdx })
                            }
                            className={`w-full p-3 rounded-lg text-left text-sm transition-all ${
                              quizAnswers[idx] === optIdx
                                ? "bg-cyan-500 text-white"
                                : "bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                            }`}
                          >
                            {String.fromCharCode(65 + optIdx)}. {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={submitQuiz}
                    disabled={Object.keys(quizAnswers).length < quiz.length}
                    className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-white font-medium mt-4 disabled:opacity-50"
                  >
                    Submit Quiz
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
