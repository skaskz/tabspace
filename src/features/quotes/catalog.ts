/**
 * Curated motivational quotes. Inclusion rule: the attribution must be well
 * documented (a named book, letter, speech, essay or interview). Popular
 * quotes with doubtful attributions (many "Einstein", "Twain", "Confucius",
 * "Aristotle" lines) are deliberately left out. Anonymous sayings are
 * labelled "Proverb". Classical texts are given in common English renderings.
 *
 * Order matters: favourites are stored as indices, so only append new quotes.
 */

export interface Quote {
  text: string;
  author: string;
  /** Where the line comes from, for the curious (shown as a tooltip). */
  source?: string;
}

export const QUOTES: Quote[] = [
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin', source: "Poor Richard's Almanack, 1737" },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin', source: "Poor Richard's Almanack, 1748" },
  { text: 'Little strokes fell great oaks.', author: 'Benjamin Franklin', source: "Poor Richard's Almanack, 1750" },
  { text: 'Diligence is the mother of good luck.', author: 'Benjamin Franklin', source: "Poor Richard's Almanack, 1736" },
  { text: 'You may delay, but time will not.', author: 'Benjamin Franklin', source: 'The Way to Wealth, 1758' },
  { text: 'One today is worth two tomorrows.', author: 'Benjamin Franklin', source: "Poor Richard's Almanack" },
  { text: "Dost thou love life? Then do not squander time, for that's the stuff life is made of.", author: 'Benjamin Franklin', source: "Poor Richard's Almanack, 1746" },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant', source: 'The Story of Philosophy, 1926' },
  { text: 'The best way out is always through.', author: 'Robert Frost', source: 'A Servant to Servants, 1914' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard', source: 'The Writing Life, 1989' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Laozi', source: 'Tao Te Ching, ch. 64' },
  { text: 'While we are postponing, life speeds by.', author: 'Seneca', source: 'Letters to Lucilius, 1' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca', source: 'On the Shortness of Life' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', author: 'Marcus Aurelius', source: 'Meditations, 10.16' },
  { text: 'Very little is needed to make a happy life.', author: 'Marcus Aurelius', source: 'Meditations, 7.67' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus', source: 'Discourses, 3.23' },
  { text: 'No great thing is created suddenly.', author: 'Epictetus', source: 'Discourses, 1.15' },
  { text: 'The beginning is the most important part of the work.', author: 'Plato', source: 'The Republic' },
  { text: 'Make haste slowly.', author: 'Augustus', source: 'via Suetonius, Lives of the Caesars' },
  { text: 'Fortune favours the bold.', author: 'Terence', source: 'Phormio' },
  { text: 'Genius is one per cent inspiration, ninety-nine per cent perspiration.', author: 'Thomas Edison', source: 'Interview, c. 1903' },
  { text: 'Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry', source: 'Wind, Sand and Stars, 1939' },
  { text: 'Simple can be harder than complex: you have to work hard to get your thinking clean to make it simple.', author: 'Steve Jobs', source: 'BusinessWeek, 1998' },
  { text: 'Real artists ship.', author: 'Steve Jobs', source: 'Macintosh team, 1983' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs', source: 'Stanford commencement, 2005' },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: 'Steve Jobs', source: 'Stanford commencement, 2005' },
  { text: 'Inspiration is for amateurs — the rest of us just show up and get to work.', author: 'Chuck Close' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds', source: 'Linux kernel mailing list, 2000' },
  { text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth', source: 'Structured Programming with go to Statements, 1974' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson & Gerald Jay Sussman', source: 'Structure and Interpretation of Computer Programs' },
  { text: 'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', author: 'Martin Fowler', source: 'Refactoring, 1999' },
  { text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra', source: 'EWD498, 1975' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: "It always takes longer than you expect, even when you take into account Hofstadter's Law.", author: 'Douglas Hofstadter', source: 'Gödel, Escher, Bach, 1979' },
  { text: 'Work expands so as to fill the time available for its completion.', author: 'C. Northcote Parkinson', source: 'The Economist, 1955' },
  { text: 'If I have seen further it is by standing on the shoulders of Giants.', author: 'Isaac Newton', source: 'Letter to Robert Hooke, 1675' },
  { text: 'Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.', author: 'Samuel Beckett', source: 'Worstward Ho, 1983' },
  { text: "I am not afraid of storms, for I am learning how to sail my ship.", author: 'Louisa May Alcott', source: 'Little Women, 1868' },
  { text: "Be so good they can't ignore you.", author: 'Steve Martin', source: 'Charlie Rose interview' },
  { text: 'Plans are worthless, but planning is everything.', author: 'Dwight D. Eisenhower', source: 'Speech, 1957' },
  { text: 'What is important is seldom urgent and what is urgent is seldom important.', author: 'Dwight D. Eisenhower', source: 'Speech, 1954' },
  { text: 'Courage is grace under pressure.', author: 'Ernest Hemingway', source: 'The New Yorker, 1929' },
  { text: 'Imagination is more important than knowledge.', author: 'Albert Einstein', source: 'The Saturday Evening Post, 1929' },
  { text: 'Life is like riding a bicycle. To keep your balance you must keep moving.', author: 'Albert Einstein', source: 'Letter to his son Eduard, 1930' },
  { text: 'Rest is not idleness.', author: 'John Lubbock', source: 'The Use of Life, 1894' },
  { text: 'Lose an hour in the morning, and you will spend all day looking for it.', author: 'Richard Whately' },
  { text: 'Focusing is about saying no.', author: 'Steve Jobs', source: 'WWDC, 1997' },
  { text: 'The two most powerful warriors are patience and time.', author: 'Leo Tolstoy', source: 'War and Peace' },
  { text: 'Well begun is half done.', author: 'Proverb' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb' },
  { text: 'Do not fear going forward slowly; fear only to stand still.', author: 'Chinese proverb' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
  { text: "Don't mistake activity with achievement.", author: 'John Wooden' },
  { text: "If you don't have time to do it right, when will you have time to do it over?", author: 'John Wooden' },
  { text: 'Do not let what you cannot do interfere with what you can do.', author: 'John Wooden' },
  { text: 'Be regular and orderly in your life, so that you may be violent and original in your work.', author: 'Gustave Flaubert', source: 'Letter, 1876' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh', source: 'Letter to Theo, 1882' },
  { text: 'What would life be if we had no courage to attempt anything?', author: 'Vincent van Gogh', source: 'Letter to Theo, 1881' },
  { text: 'To improve is to change; to be perfect is to change often.', author: 'Winston Churchill', source: 'House of Commons, 1925' },
  { text: 'Life can only be understood backwards; but it must be lived forwards.', author: 'Søren Kierkegaard', source: 'Journals, 1843' },
  { text: "You miss 100% of the shots you don't take.", author: 'Wayne Gretzky', source: 'Interview, 1983' },
  { text: 'Your mind is for having ideas, not holding them.', author: 'David Allen', source: 'Getting Things Done' },
  { text: 'You can do anything, but not everything.', author: 'David Allen' },
  { text: 'Until we can manage time, we can manage nothing else.', author: 'Peter Drucker', source: 'The Effective Executive, 1967' },
  { text: 'There is nothing so useless as doing efficiently that which should not be done at all.', author: 'Peter Drucker', source: 'Harvard Business Review, 1963' },
  { text: 'Time is what we want most, but what we use worst.', author: 'William Penn', source: 'Some Fruits of Solitude, 1693' },
  { text: 'It is not enough to be busy; so are the ants. The question is: What are we busy about?', author: 'Henry David Thoreau', source: 'Letter to H. G. O. Blake, 1857' },
  { text: 'Our life is frittered away by detail. Simplify, simplify.', author: 'Henry David Thoreau', source: 'Walden, 1854' },
  { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche', source: 'Twilight of the Idols, 1889' },
  { text: 'The harder the conflict, the more glorious the triumph.', author: 'Thomas Paine', source: 'The American Crisis, 1776' },
];
