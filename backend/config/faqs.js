/**
 * Structured, configurable FAQ content.
 *
 * Grouped by category so the frontend can render a categorized FAQ panel
 * without any FAQ text living in UI components. Each entry has an id (for
 * stable analytics/event tracking), a question, and answers in English
 * and Urdu. Adding a new question later is just adding an object here —
 * no component changes needed.
 */

const faqCategories = [
  {
    id: 'new_patients',
    label: 'New Patients',
    labelUr: 'نئے مریض',
    items: [
      {
        id: 'np_what_to_bring',
        question: 'What should I bring to my first visit?',
        questionUr: 'پہلی وزٹ پر کیا لانا چاہیے؟',
        answer: 'Please bring a photo ID, your insurance card (if you have one), and a list of any medications you take.',
        answerUr: 'براہ کرم شناختی کارڈ، انشورنس کارڈ (اگر ہو) اور اپنی موجودہ ادویات کی فہرست ساتھ لائیں۔',
      },
      {
        id: 'np_first_visit_time',
        question: 'How long does a first visit take?',
        questionUr: 'پہلی وزٹ میں کتنا وقت لگتا ہے؟',
        answer: 'New patient visits typically take 45-60 minutes, including a consultation and initial exam.',
        answerUr: 'نئے مریض کی وزٹ عام طور پر 45 سے 60 منٹ لیتی ہے، جس میں مشورہ اور ابتدائی معائنہ شامل ہے۔',
      },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    labelUr: 'خدمات',
    items: [
      {
        id: 'svc_list',
        question: 'What services do you offer?',
        questionUr: 'آپ کون سی خدمات فراہم کرتے ہیں؟',
        answer: 'Cleaning, Consultation, Root Canal, Whitening, Filling, Extraction, Crown, and emergency dental care.',
        answerUr: 'صفائی، مشورہ، روٹ کینال، سفیدی، بھرائی، دانت نکلوانا، کراؤن، اور ہنگامی دانتوں کا علاج۔',
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    labelUr: 'ادائیگی',
    items: [
      {
        id: 'pay_methods',
        question: 'What payment methods do you accept?',
        questionUr: 'آپ کون سے ادائیگی کے طریقے قبول کرتے ہیں؟',
        answer: 'We accept major credit/debit cards, cash, and most PPO dental insurance plans.',
        answerUr: 'ہم بڑے کریڈٹ/ڈیبٹ کارڈز، نقدی، اور زیادہ تر PPO ڈینٹل انشورنس پلانز قبول کرتے ہیں۔',
      },
      {
        id: 'pay_plans',
        question: 'Do you offer payment plans?',
        questionUr: 'کیا آپ قسطوں میں ادائیگی کی سہولت دیتے ہیں؟',
        answer: "For treatments over $500, ask our front desk about a payment plan — I don't have the exact terms, so I'll connect you with our team for that.",
        answerUr: '$500 سے زیادہ کے علاج کے لیے ہمارے فرنٹ ڈیسک سے قسطوں کے بارے میں پوچھیں — تفصیلات کے لیے میں آپ کو ٹیم سے ملواتا ہوں۔',
      },
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance',
    labelUr: 'انشورنس',
    items: [
      {
        id: 'ins_verify',
        question: 'How do I know if my insurance is accepted?',
        questionUr: 'مجھے کیسے پتا چلے کہ میری انشورنس قبول کی جاتی ہے؟',
        answer: 'Tell me your insurance provider and I\'ll check against our accepted list, or our front desk can verify your exact plan.',
        answerUr: 'مجھے اپنی انشورنس کمپنی کا نام بتائیں، میں چیک کر لیتا ہوں، یا ہمارا فرنٹ ڈیسک آپ کے پلان کی تصدیق کر سکتا ہے۔',
      },
    ],
  },
  {
    id: 'emergency',
    label: 'Emergency',
    labelUr: 'ہنگامی صورتحال',
    items: [
      {
        id: 'em_same_day',
        question: 'Do you offer same-day emergency appointments?',
        questionUr: 'کیا آپ اسی دن ہنگامی اپائنٹمنٹ دیتے ہیں؟',
        answer: 'Yes, we hold same-day slots for urgent dental issues like severe pain, swelling, or trauma.',
        answerUr: 'جی ہاں، شدید درد، سوجن یا چوٹ جیسی ہنگامی صورتحال کے لیے ہم اسی دن کے سلاٹ محفوظ رکھتے ہیں۔',
      },
    ],
  },
  {
    id: 'children',
    label: 'Children',
    labelUr: 'بچے',
    items: [
      {
        id: 'kids_age',
        question: 'What age do you start seeing children?',
        questionUr: 'آپ کس عمر سے بچوں کا معائنہ شروع کرتے ہیں؟',
        answer: "We recommend a first dental visit by age one, or within six months of the first tooth appearing.",
        answerUr: 'پہلی دانتوں کی وزٹ ایک سال کی عمر تک، یا پہلے دانت نکلنے کے چھ ماہ کے اندر تجویز کی جاتی ہے۔',
      },
    ],
  },
  {
    id: 'parking',
    label: 'Parking',
    labelUr: 'پارکنگ',
    items: [
      {
        id: 'parking_avail',
        question: 'Is parking available?',
        questionUr: 'کیا پارکنگ دستیاب ہے؟',
        answer: 'Yes, free parking is available directly in front of the clinic.',
        answerUr: 'جی ہاں، کلینک کے سامنے مفت پارکنگ دستیاب ہے۔',
      },
    ],
  },
  {
    id: 'directions',
    label: 'Directions',
    labelUr: 'راستہ',
    items: [
      {
        id: 'dir_location',
        question: 'Where are you located?',
        questionUr: 'آپ کہاں واقع ہیں؟',
        answer: '123 Dental Lane, Smile City, SC 12345.',
        answerUr: '123 Dental Lane, Smile City, SC 12345۔',
      },
    ],
  },
  {
    id: 'cancellation_policy',
    label: 'Cancellation Policy',
    labelUr: 'منسوخی کی پالیسی',
    items: [
      {
        id: 'cancel_window',
        question: "What's your cancellation policy?",
        questionUr: 'آپ کی منسوخی کی پالیسی کیا ہے؟',
        answer: 'Appointments can be cancelled or rescheduled free of charge up to 24 hours before the appointment time.',
        answerUr: 'اپائنٹمنٹ سے 24 گھنٹے پہلے تک منسوخی یا تاریخ کی تبدیلی مفت ہے۔',
      },
    ],
  },
  {
    id: 'office_hours',
    label: 'Office Hours',
    labelUr: 'اوقات کار',
    items: [
      {
        id: 'hours_general',
        question: 'What are your office hours?',
        questionUr: 'آپ کے اوقاتِ کار کیا ہیں؟',
        answer: '9:00 AM - 5:00 PM, Monday through Friday.',
        answerUr: 'پیر سے جمعہ، صبح 9 بجے سے شام 5 بجے تک۔',
      },
    ],
  },
  {
    id: 'what_to_bring',
    label: 'What to Bring',
    labelUr: 'کیا لانا ہے',
    items: [
      {
        id: 'bring_general',
        question: 'What should I bring to my appointment?',
        questionUr: 'اپائنٹمنٹ کے لیے کیا لانا چاہیے؟',
        answer: 'A photo ID and your insurance card if you have one. Returning patients don\'t need to bring anything else.',
        answerUr: 'شناختی کارڈ اور اگر ہو تو انشورنس کارڈ۔ پرانے مریضوں کو مزید کچھ لانے کی ضرورت نہیں۔',
      },
    ],
  },
  {
    id: 'general',
    label: 'General Questions',
    labelUr: 'عمومی سوالات',
    items: [
      {
        id: 'gen_contact',
        question: 'How can I contact the office directly?',
        questionUr: 'میں دفتر سے براہ راست کیسے رابطہ کروں؟',
        answer: 'Call us at +1-555-SMILE-01 or email info@smileverse.com.',
        answerUr: 'ہمیں +1-555-SMILE-01 پر کال کریں یا info@smileverse.com پر ای میل کریں۔',
      },
    ],
  },
];

module.exports = faqCategories;
