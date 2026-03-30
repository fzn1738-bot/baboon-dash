import React, { useEffect, useState } from 'react';
import { UserRole, FAQItem } from '../types';
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { HelpCircle, Edit2, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';

interface FAQProps {
  userRole: UserRole;
}

export const FAQ: React.FC<FAQProps> = ({ userRole }) => {
  const [faqItems, setFaqItems] = useState<FAQItem[]>([]);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const faqCollection = collection(db, 'faqs');
    const unsubscribe = onSnapshot(
      faqCollection,
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<FAQItem, 'id'>) }))
          .sort((a, b) => {
            const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
            if (orderDiff !== 0) return orderDiff;
            return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
          });
        setFaqItems(items);
      },
      (error) => {
        console.error('FAQ listener error:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const resetEditor = () => {
    setFaqQuestion('');
    setFaqAnswer('');
    setEditingFaqId(null);
  };

  const handleSaveFaq = async () => {
    const question = faqQuestion.trim();
    const answer = faqAnswer.trim();
    if (!question || !answer) return;
    setIsSaving(true);

    try {
      if (editingFaqId) {
        await updateDoc(doc(db, 'faqs', editingFaqId), {
          question,
          answer,
          updatedAt: new Date().toISOString()
        });
        resetEditor();
        return;
      }

      await addDoc(collection(db, 'faqs'), {
        question,
        answer,
        order: faqItems.length + 1,
        updatedAt: new Date().toISOString()
      });
      resetEditor();
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditFaq = (faq: FAQItem) => {
    setFaqQuestion(faq.question);
    setFaqAnswer(faq.answer);
    setEditingFaqId(faq.id);
  };

  const handleDeleteFaq = async (faqId: string) => {
    await deleteDoc(doc(db, 'faqs', faqId));
    if (editingFaqId === faqId) {
      resetEditor();
    }
  };

  const updateFaqOrder = async (items: FAQItem[]) => {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await updateDoc(doc(db, 'faqs', item.id), {
        order: index + 1,
        updatedAt: new Date().toISOString()
      });
    }
  };

  const handleMoveFaq = async (faqId: string, direction: 'UP' | 'DOWN') => {
    const currentIndex = faqItems.findIndex((item) => item.id === faqId);
    if (currentIndex < 0) return;
    const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= faqItems.length) return;

    const reordered = [...faqItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    await updateFaqOrder(reordered);
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <div className="flex items-center gap-3 px-4 md:px-0">
        <HelpCircle className="text-sky-400" />
        <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
      </div>

      {userRole === 'ADMIN' && (
        <div className="px-4 md:px-0">
          <div className="bg-slate-800/70 border border-slate-700 rounded-2xl p-4 md:p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">FAQ Content Manager</h3>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="text"
                value={faqQuestion}
                onChange={(e) => setFaqQuestion(e.target.value)}
                placeholder="Question"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
              />
              <textarea
                value={faqAnswer}
                onChange={(e) => setFaqAnswer(e.target.value)}
                placeholder="Answer"
                rows={4}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveFaq}
                disabled={!faqQuestion.trim() || !faqAnswer.trim() || isSaving}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="inline-flex items-center gap-1">
                  <Save size={12} />
                  {isSaving ? 'Saving...' : editingFaqId ? 'Save FAQ Changes' : 'Commit FAQ'}
                </span>
              </button>
              {editingFaqId && (
                <button
                  onClick={resetEditor}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {faqItems.length === 0 ? (
        <div className="mx-4 md:mx-0 rounded-2xl border border-slate-700 bg-slate-800/60 p-6 text-slate-400 text-sm">
          No FAQ entries yet. {userRole === 'ADMIN' ? 'Use the FAQ Content Manager above to add your first Q&A.' : 'Check back soon.'}
        </div>
      ) : (
        <div className="space-y-3 px-4 md:px-0">
          {faqItems.map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-bold text-white">{item.question}</h3>
                {userRole === 'ADMIN' && (
                  <div className="flex gap-1">
                    <button onClick={() => handleMoveFaq(item.id, 'UP')} className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-500/10" title="Move up">
                      <ArrowUp size={13} />
                    </button>
                    <button onClick={() => handleMoveFaq(item.id, 'DOWN')} className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-500/10" title="Move down">
                      <ArrowDown size={13} />
                    </button>
                    <button onClick={() => handleEditFaq(item)} className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10" title="Edit FAQ">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDeleteFaq(item.id)} className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10" title="Delete FAQ">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {userRole === 'ADMIN' && (
                <div className="text-[10px] text-slate-500 mb-2">Display Order: #{item.order ?? '-'}</div>
              )}
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{item.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
