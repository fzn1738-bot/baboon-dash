import React, { useEffect, useState } from 'react';
import { UserRole, FAQItem } from '../types';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { HelpCircle } from 'lucide-react';

interface FAQProps {
  userRole: UserRole;
}

export const FAQ: React.FC<FAQProps> = ({ userRole }) => {
  const [faqItems, setFaqItems] = useState<FAQItem[]>([]);

  useEffect(() => {
    const faqCollection = collection(db, 'faqs');
    const unsubscribe = onSnapshot(
      faqCollection,
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<FAQItem, 'id'>) }))
          .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
        setFaqItems(items);
      },
      (error) => {
        console.error('FAQ listener error:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <div className="flex items-center gap-3 px-4 md:px-0">
        <HelpCircle className="text-sky-400" />
        <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
      </div>

      {faqItems.length === 0 ? (
        <div className="mx-4 md:mx-0 rounded-2xl border border-slate-700 bg-slate-800/60 p-6 text-slate-400 text-sm">
          No FAQ entries yet. {userRole === 'ADMIN' ? 'Use the Admin Dashboard → Users to add your first Q&A.' : 'Check back soon.'}
        </div>
      ) : (
        <div className="space-y-3 px-4 md:px-0">
          {faqItems.map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
              <h3 className="text-sm font-bold text-white mb-2">{item.question}</h3>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{item.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
