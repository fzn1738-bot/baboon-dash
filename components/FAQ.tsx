import React, { useEffect, useState } from 'react';
import { UserRole, FAQItem } from '../types';
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchFaqs = async () => {
    const response = await fetch('/api/faqs');
    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'Failed to load FAQs');
    }
    setFaqItems(data.items || []);
    setLoadError(null);
  };

  useEffect(() => {
    fetchFaqs().catch((error) => {
      console.error('FAQ load error:', error);
      setLoadError('Unable to load FAQs right now. Please try again.');
    });
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
        const response = await fetch(`/api/faqs/${editingFaqId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, answer })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to update FAQ');
        }
        await fetchFaqs();
        resetEditor();
        return;
      }

      const response = await fetch('/api/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, order: faqItems.length + 1 })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to create FAQ');
      }
      await fetchFaqs();
      resetEditor();
    } catch (error) {
      console.error('FAQ save error:', error);
      setLoadError('Failed to save FAQ. Please try again.');
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
    try {
      const response = await fetch(`/api/faqs/${faqId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to delete FAQ');
      }
      await fetchFaqs();
      if (editingFaqId === faqId) {
        resetEditor();
      }
    } catch (error) {
      console.error('FAQ delete error:', error);
      setLoadError('Failed to delete FAQ. Please try again.');
    }
  };

  const updateFaqOrder = async (items: FAQItem[]) => {
    const faqIds = items.map((item) => item.id);
    const response = await fetch('/api/faqs/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faqIds })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || 'Failed to reorder FAQs');
    }
    await fetchFaqs();
  };

  const handleMoveFaq = async (faqId: string, direction: 'UP' | 'DOWN') => {
    const currentIndex = faqItems.findIndex((item) => item.id === faqId);
    if (currentIndex < 0) return;
    const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= faqItems.length) return;

    const reordered = [...faqItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    try {
      await updateFaqOrder(reordered);
    } catch (error) {
      console.error('FAQ reorder error:', error);
      setLoadError('Failed to reorder FAQs. Please try again.');
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <div className="flex items-center gap-3 px-4 md:px-0">
        <HelpCircle className="text-sky-400" />
        <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
      </div>
      {loadError && (
        <div className="mx-4 md:mx-0 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {loadError}
        </div>
      )}

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
