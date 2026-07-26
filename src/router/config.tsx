import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import Login from "../pages/login/page";
import Register from "../pages/register/page";
import Dashboard from "../pages/dashboard/page";
import TeacherDashboard from "../pages/teacher-dashboard/page";
import TeacherProfile from "../pages/teacher-profile/page";
import AdminDashboard from "../pages/admin/page";
import SprintSession from "../pages/sprint-session/page";
import SprintComplete from "../pages/sprint-complete/page";
import CourseDetail from "../pages/course-detail/page";
import ResetPassword from "../pages/reset-password/page";
import BootstrapSetup from "../pages/bootstrap-setup/page";
import NotificationsPage from "../pages/notifications/page";
import ProfilePage from "../pages/profile/page";
import CoursesPage from "../pages/courses/page";
import BookingCalendar from "../pages/booking/page";
import HistoryPage from "../pages/history/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/setup",
    element: <BootstrapSetup />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/register",
    element: <Register />,
  },
  {
    path: "/reset-password",
    element: <ResetPassword />,
  },
  {
    path: "/dashboard",
    element: <Dashboard />,
  },
  {
    path: "/teacher/dashboard",
    element: <TeacherDashboard />,
  },
  {
    path: "/teacher-dashboard",
    element: <Navigate to="/teacher/dashboard" replace />,
  },
  {
    path: "/teacher/profile",
    element: <TeacherProfile />,
  },
  {
    path: "/admin/dashboard",
    element: <AdminDashboard />,
  },
  {
    path: "/dashboard/sprint/:sprintId/session/:sessionId",
    element: <SprintSession />,
  },
  {
    path: "/dashboard/sprint/:sprintId/complete",
    element: <SprintComplete />,
  },
  {
    path: "/courses/:id",
    element: <CourseDetail />,
  },
  {
    path: "/courses",
    element: <CoursesPage />,
  },
  {
    path: "/notifications",
    element: <NotificationsPage />,
  },
  {
    path: "/profile",
    element: <ProfilePage />,
  },
  {
    path: "/dashboard/book",
    element: <BookingCalendar />,
  },
  {
    path: "/dashboard/history",
    element: <HistoryPage />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;