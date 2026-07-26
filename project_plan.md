# Better Minds – Charity English Learning Platform

## 1. Project Description
A Learning Management System (LMS) for a non-profit English learning organization called Better Minds. Unlike traditional booking platforms, this system is built around the philosophy of **Commit → Learn → Complete → Continue** — encouraging commitment and accountability while allowing flexible, self-paced learning. The platform automates scheduling to reduce administrative overhead for volunteer teachers and staff.

**Target Users**: Learners (students), Vietnamese Teachers, Foreign Teachers, Administrators

## 2. Page Structure

### Public Pages
- `/` - Landing/Home page (platform introduction, philosophy, how it works)
- `/login` - Login page
- `/register` - Learner registration

### Learner Pages
- `/dashboard` - Learner Dashboard (current sprint, progress, countdown, upcoming lessons)
- `/courses` - Course catalog & enrollment
- `/courses/:id` - Course detail page
- `/sprint/:id` - Sprint detail (sessions, confirm schedule)
- `/sprint/:id/session/:sessionNum` - Session page (self-study or live lesson)
- `/history` - Learning history & completed sprints
- `/profile` - User profile & study commitment settings

### Teacher Pages (Vietnamese & Foreign)
- `/teacher/dashboard` - Teacher Dashboard (weekly schedule, upcoming lessons, stats)
- `/teacher/availability` - Weekly availability management
- `/teacher/lessons` - Upcoming & past lessons
- `/teacher/lessons/:id` - Lesson detail & feedback form
- `/teacher/profile` - Teacher profile

### Admin Pages
- `/admin/dashboard` - Admin Dashboard (analytics, overview)
- `/admin/learners` - Learner management
- `/admin/teachers` - Teacher management
- `/admin/courses` - Course management
- `/admin/sprints` - Sprint monitoring & exception handling
- `/admin/reports` - Reports & analytics
- `/admin/settings` - System settings (deadline configs, etc.)

## 3. Core Features

### Phase 1 - Landing & Foundation
- [ ] Landing page with platform introduction
- [ ] How it works section
- [ ] Role-based information (learners, teachers)
- [ ] FAQ section
- [ ] Contact / Newsletter form
- [ ] Project setup (i18n, routing, StyleSystem)

### Phase 2 - Authentication
- [x] User registration (learner signup) — disabled public registration; accounts now created by Admin only
- [x] User login
- [x] Role-based login flows: Learner portal and Teacher portal with separate UI
- [x] Role-based access control (4 roles)
- [x] Role-based dashboard routing (learner → /dashboard, teacher → /teacher/dashboard, admin → /admin/dashboard)
- [x] Protected routes
- [x] Admin account creation page with Edge Function (admin-create-user)
- [x] Teacher dashboard skeleton
- [x] Admin dashboard skeleton with account creation tab

### Phase 3 - Learner Dashboard & Courses
- [x] Course catalog page (embedded in dashboard)
- [x] Course enrollment flow (choose commitment, preferred time)
- [x] Learner Dashboard (current sprint, progress, countdown timer)
- [x] Learning history page
- [x] Learner profile page with study settings & Auto Sprint toggle

### Phase 4 - Teacher System
- [x] Teacher Dashboard (Overview / Schedule / Students tabs)
  - [x] Flexible Recurring Schedule (weekly availability)
  - [x] Minimum 6-hour weekly commitment validation
  - [x] One-time unavailable dates
  - [x] Upcoming lessons view

### Phase 5 - Sprint & Session System
- [ ] Learning Sprint system (3-session structure)
- [ ] Session 1: Self-study page (objectives, materials, summary form)
- [ ] Session 2: Vietnamese Teacher live lesson
- [ ] Session 3: Foreign Teacher live lesson
- [x] Sequential session unlocking
- [ ] Sprint deadline system with countdown

### Phase 6 - Auto Scheduling Engine
- [x] Smart Scheduling Engine (Edge Function)
- [x] Auto Sprint preparation & suggestion
- [ ] Learner confirmation flow
- [ ] Alternative options display (5-10 alternatives)
- [x] Teacher workload balancing

### Phase 7 - Admin Dashboard
- [x] Admin overview dashboard
- [x] Learner management
- [x] Learner reset action (reset missed_deadlines counter + reactivate paused enrollment)
- [x] Teacher management
- [x] Course management
- [x] Sprint monitoring
- [x] Exception handling (deadline extensions, pauses)
- [x] System settings & configurations (deadline defaults, missed threshold, system_settings table)
- [x] Course-level deadline override (per-course custom deadline hours, fallback to system defaults)

### Phase 8 - Notifications
- [x] In-app notification center
- [x] Sprint deadline system with countdown
- [x] Deadline enforcement (auto-expire, missed_deadlines counter, auto-pause after 2 misses)
- [x] Email notifications (via Resend)
- [x] Sprint confirmation notifications
- [x] Deadline reminders
- [x] Missed deadline warnings
- [x] Admin auto-pause notification (admins notified when a learner is auto-paused due to missed deadline threshold)

### Phase 9 - Polish & Future
- [ ] Mobile responsive optimization
- [x] Auto Sprint Mode
- [x] Missed deadline policy enforcement
- [x] Sprint continuity (auto-activation)
- [x] Reports & analytics
- [ ] Future expansion (multiple courses, certificates, gamification)

## 4. Data Model Design

### Table: users
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| email | text | User email |
| full_name | text | Full name |
| role | enum | 'learner', 'vietnamese_teacher', 'foreign_teacher', 'admin' |
| phone | text | Phone number (optional) |
| avatar_url | text | Profile picture URL |
| created_at | timestamptz | Account creation time |

### Table: learner_profiles
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to users |
| study_commitment | int | Sessions per week (2/3/4) |
| preferred_time | text | Preferred study time description |
| auto_sprint_mode | boolean | Auto Sprint enabled |
| status | enum | 'active', 'paused', 'completed' |
| missed_deadlines | int | Consecutive missed deadline count |

### Table: teacher_profiles
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to users |
| weekly_commitment_hours | int | Minimum 6 hours |
| bio | text | Teacher introduction |
| specialties | text[] | Teaching specialties |

### Table: teacher_availability
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| teacher_id | uuid | FK to teacher_profiles |
| day_of_week | int | 0=Sunday, 1=Monday, ... |
| start_time | time | Start time |
| end_time | time | End time |
| is_active | boolean | Currently active |

### Table: teacher_unavailable_dates
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| teacher_id | uuid | FK to teacher_profiles |
| date | date | Unavailable date |
| reason | text | Optional reason |

### Table: courses
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Course name (e.g. "English Level B1") |
| description | text | Course description |
| level | text | Level (A1, A2, B1, etc.) |
| is_active | boolean | Currently available |
| deadline_config | jsonb | Configurable deadlines per commitment |

### Table: enrollments
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| learner_id | uuid | FK to learner_profiles |
| course_id | uuid | FK to courses |
| study_commitment | int | Sessions/week |
| preferred_time | text | Preferred study time |
| status | enum | 'active', 'paused', 'completed' |
| enrolled_at | timestamptz | Enrollment date |

### Table: learning_sprints
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| enrollment_id | uuid | FK to enrollments |
| sprint_number | int | Sequential sprint number |
| status | enum | 'pending', 'active', 'completed', 'expired' |
| deadline_session1 | timestamptz | Session 1 deadline |
| deadline_session2 | timestamptz | Session 2 deadline |
| deadline_session3 | timestamptz | Session 3 deadline |
| created_at | timestamptz | Sprint creation time |
| completed_at | timestamptz | Sprint completion time |

### Table: sprint_sessions
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| sprint_id | uuid | FK to learning_sprints |
| session_number | int | 1, 2, or 3 |
| session_type | enum | 'self_study', 'vietnamese_teacher', 'foreign_teacher' |
| teacher_id | uuid | FK to teacher_profiles (null for session 1) |
| scheduled_at | timestamptz | Scheduled lesson time |
| status | enum | 'locked', 'available', 'in_progress', 'completed' |
| completed_at | timestamptz | Completion time |
| feedback | text | Teacher feedback (sessions 2, 3) |
| lesson_summary | text | Learner's summary (session 1) |

### Table: notifications
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to users |
| type | text | Notification type |
| title | text | Notification title |
| message | text | Notification body |
| is_read | boolean | Read status |
| created_at | timestamptz | Creation time |

## 5. Backend / Third-party Integration Plan

- **Supabase**: Required for authentication (multi-role), database, Edge Functions (scheduling engine), and email notifications
- **Resend**: For email notifications (can use Resend integration when available)
- **Shopify**: Not needed
- **Stripe**: Not needed (non-profit, free platform)
- **Readdy Agent**: Optional - could be added for learner Q&A support

## 6. Development Phase Plan

### Phase 1: Landing Page & Project Foundation
- Goal: Create a beautiful, informative landing page that introduces the platform, its philosophy, and how it works for each role
- Deliverable: Complete landing page with hero, how it works, role sections, FAQ, and footer with newsletter form
- Pages: `/` (Home/Landing)

### Phase 2: Authentication System
- Goal: Implement user registration, login, and role-based access control
- Deliverable: Login page, registration page, protected routing, basic profile page
- Requires: Supabase connection

### Phase 3: Learner Dashboard & Course Enrollment
- Goal: Allow learners to browse courses, enroll with commitments, and see their dashboard
- Deliverable: Course catalog, enrollment flow, learner dashboard with mock sprint data

### Phase 4: Teacher Dashboard & Availability
- Goal: Teachers can manage weekly availability with validation
- Deliverable: Teacher dashboard, availability management UI, minimum hours validation

### Phase 5: Sprint & Session System
- Goal: Full sprint lifecycle with session sequencing
- Deliverable: Sprint view, session pages, deadline tracking, sequential unlocking

### Phase 6: Auto Scheduling Engine
- Goal: Smart scheduling that auto-suggests teacher sessions
- Deliverable: Scheduling Edge Function, suggestion UI, confirmation flow

### Phase 7: Admin Dashboard
- Goal: Full admin control panel
- Deliverable: Admin overview, management pages, exception handling, settings

### Phase 8: Notifications & Polish
- Goal: Complete notification system and final polish
- Deliverable: In-app notifications, email notifications, mobile optimization