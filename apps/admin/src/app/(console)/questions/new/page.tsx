/** A new question starts as a draft (doc 04 §3). */
import Link from 'next/link';
import { QuestionForm } from '../QuestionForm';

export default function NewQuestion() {
  return (
    <>
      <div className="row">
        <Link href="/questions">← Questions</Link>
      </div>
      <h1>New question</h1>
      <p className="muted">
        Write it in your own words from a reliable source, and add the link. Someone else fact-checks it
        before an editor publishes it.
      </p>
      <QuestionForm />
    </>
  );
}
