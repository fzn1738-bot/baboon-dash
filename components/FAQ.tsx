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
      const method = editingFaqId ? 'PUT' : 'POST';
      const url = editingFaqId ? `/api/faqs/${editingFaqId}` : '/api/faqs';
      const body = editingFaqId 
        ? { question, answer } 
        : { question, answer, order: faqItems.length + 1 };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save FAQ');
      }

      await fetchFaqs();
      resetEditor();
    } catch (error) {
      console.error('Error saving FAQ:', error);
      alert('Failed to save FAQ. Please check the console for details.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditFaq = (faq: FAQItem) => {
    setFaqQuestion(faq.question);
    setFaqAnswer(faq.answer);
    setEditingFaqId(faq.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteFaq = async (faqId: string) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;

    try {
      const response = await fetch(`/api/faqs/${faqId}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete FAQ');
      }
      await fetchFaqs();
      if (editingFaqId === faqId) resetEditor();
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      alert('Failed to delete FAQ.');
    }
  };

  const handleMoveFaq = async (faqId: string, direction: 'UP' | 'DOWN') => {
    const index = faqItems.findIndex(item => item.id === faqId);
    if (index === -1) return;
    if (direction === 'UP' && index === 0) return;
    if (direction === 'DOWN' && index === faqItems.length - 1) return;

    const newItems = [...faqItems];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];

    // Optimistically update UI
    setFaqItems(newItems);

    try {
      const response = await fetch('/api/faqs/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ids: newItems.map(item => item.id) 
        })
      });
      if (!response.ok) throw new Error('Failed to reorder');
    } catch (error) {
      console.error('Reorder error:', error);
      fetchFaqs(); // Revert on failure
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in max-w-4xl mx-auto">
      <div className="flex items-center gap-3 px-4 md:px-0">
        <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
          <HelpCircle className="text-amber-500" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
      </div>

      {userRole === 'ADMIN' && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            {editingFaqId ? <Edit2 size={18} className="text-sky-400" /> : <Save size={18} className="text-emerald-400" />}
            {editingFaqId ? 'Edit FAQ Entry' : 'Add New FAQ Entry'}
          </h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question</label>
              <input 
                type="text" 
                value={faqQuestion} 
                onChange={(e) => setFaqQuestion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors" 
                placeholder="What is the average return?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Answer</label>
              <textarea 
                value={faqAnswer} 
                onChange={(e) => setFaqAnswer(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors resize-none" 
                placeholder="The average historical return is..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                onClick={handleSaveFaq}
                disabled={isSaving || !faqQuestion.trim() || !faqAnswer.trim()}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center justify-center gap-2"
              >
                {isSaving ? 'Saving...' : editingFaqId ? 'Update FAQ' : 'Publish FAQ'}
              </button>
              {editingFaqId && (
                <button 
                  onClick={resetEditor}
                  className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition-all border border-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm text-center">
          {loadError}
        </div>
      )}

      <div className="space-y-4">
        {faqItems.length === 0 && !loadError ? (
          <div className="text-center py-12 bg-slate-900/20 rounded-2xl border border-dashed border-slate-800">
            <p className="text-slate-500 font-medium">No FAQs available yet.</p>
          </div>
        ) : (
          faqItems.map((item) => (
            <div key={item.id} className="group bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors shadow-sm">
              <div className="p-5 flex items-start justify-between gap-4">
                <h3 className="text-lg font-bold text-amber-50">{item.question}</h3>
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
              <div className="px-5 pb-5">
                {userRole === 'ADMIN' && (
                  <div className="text-[10px] text-slate-500 mb-2 font-mono">Display Order: #{item.order ?? '-'}</div>
                )}
                <p className="text-slate-400 leading-relaxed text-sm whitespace-pre-wrap">{item.answer}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
