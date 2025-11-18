import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import WalletConnection from "@/components/WalletConnection";
import { parseApiError, formatValidationDetails, getFriendlyErrorMessage } from '@/lib/apiErrors';
import Head from "next/head";
import AppHeader from "@/components/AppHeader";
import { createLogger } from '@/lib/logger';
const log = createLogger('client:profile');

export default function Profile() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    bio: "",
    socialLinks: { twitter: "", telegram: "" },
  });
  const [loading, setLoading] = useState(false);
  const [validLinks, setValidLinks] = useState({ twitter: false, telegram: false });
  const [profileLoading, setProfileLoading] = useState(true);

  // Handle input field changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name in formData.socialLinks) {
      setFormData((prev) => ({
        ...prev,
        socialLinks: { ...prev.socialLinks, [name]: value },
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // Normalize social links before sending to the backend (stable identity)
  const normalizeSocialLink = useCallback((platform, value) => {
     if (!value) return null;
  
     if (platform === "twitter") {
       if (value.startsWith("https://twitter.com/") || value.startsWith("https://x.com/")) {
         return value;
       }
       if (value.startsWith("@")) {
         return `https://twitter.com/${value.slice(1)}`;
       }
       return `https://twitter.com/${value}`;
     }
  
     if (platform === "telegram") {
       if (value.startsWith("https://t.me/")) {
         return value;
       }
       if (value.startsWith("@")) {
         return `https://t.me/${value.slice(1)}`;
       }
       return `https://t.me/${value}`;
     }
  
     return value;
  }, []);
  
  // Validate social links (stable identity)
  const validateSocialLinks = useCallback((links) => {
     const twitterValid = /^https:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]{1,15}$/.test(
       normalizeSocialLink("twitter", links.twitter)
     );
     const telegramValid = /^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(
       normalizeSocialLink("telegram", links.telegram)
     );
     setValidLinks({ twitter: twitterValid, telegram: telegramValid });
  }, [normalizeSocialLink]);

  // Toggle edit mode and update the profile
  const toggleEdit = async () => {
    if (isEditing) {
      // Validate data before submitting
      if (!formData.username.trim()) {
        toast.error("Username is required.", {
          description: "Please provide a valid username.",
          style: {
            backgroundColor: "#333",
            color: "#fff",
          },
        });
        return;
      }
  
      setLoading(true);
      try {
        const normalizedLinks = {
          twitter: normalizeSocialLink("twitter", formData.socialLinks.twitter),
          telegram: normalizeSocialLink("telegram", formData.socialLinks.telegram),
        };
  
        const response = await fetch("/api/updateProfile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...formData,
            socialLinks: normalizedLinks,
          }),
        });
  
        if (!response.ok) {
          const errInfo = await parseApiError(response);
          if (errInfo.status === 401 || errInfo.code === 'NOT_AUTHENTICATED') {
            toast.error('Your session has expired. Please sign in.', { style: { backgroundColor: "#333", color: "#fff" } });
            router.push('/login');
            return;
          }
          const details = formatValidationDetails(errInfo.details);
          const msg = errInfo.message || getFriendlyErrorMessage(errInfo.code, 'Failed to update profile');
          throw new Error(details ? `${msg}: ${details}` : msg);
        }
  
        const updatedProfile = await response.json();
        setFormData(updatedProfile);
        validateSocialLinks(updatedProfile.socialLinks);
        toast.success("Profile updated successfully!", {
          description: "Your profile changes have been saved.",
          style: {
            backgroundColor: "#333",
            color: "#fff",
          },
        });
      } catch (error) {
        toast.error("Error updating profile", {
          description: error.message,
          style: {
            backgroundColor: "#333",
            color: "#fff",
          },
        });
        validateSocialLinks({ twitter: "", telegram: "" });
      } finally {
        setLoading(false);
      }
    } else {
      validateSocialLinks(formData.socialLinks);
    }
  
    setIsEditing(!isEditing);
  };
  // Load profile data from database
  useEffect(() => {
     const loadProfile = async () => {
       if (!session?.user?.id) return;
       setProfileLoading(true);
       try {
         const response = await fetch('/api/wallet', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({ 
             action: 'getProfile'
           }),
         });
         
         if (response.ok) {
           const profileData = await response.json();
           setFormData({
             username: profileData.username || '',
             bio: profileData.bio || '',
             socialLinks: {
               twitter: profileData.twitter_link || '',
               telegram: profileData.telegram_link || '',
             },
           });
           validateSocialLinks({
             twitter: profileData.twitter_link || '',
             telegram: profileData.telegram_link || '',
           });
         } else {
           const errInfo = await parseApiError(response);
           if (errInfo.status === 401 || errInfo.code === 'NOT_AUTHENTICATED') {
             toast.error('Your session has expired. Please sign in.', { style: { backgroundColor: '#333', color: '#fff' } });
             router.push('/login');
             return;
           }
           toast.error(getFriendlyErrorMessage(errInfo.code, 'Failed to load profile'), {
             description: errInfo.message || formatValidationDetails(errInfo.details),
             style: { backgroundColor: '#333', color: '#fff' },
           });
         }
       } catch (error) {
        log.error('Error loading profile', { error });
       } finally {
         setProfileLoading(false);
       }
     };
     
     loadProfile();
  }, [session?.user?.id, router, validateSocialLinks]);

  // Handle wallet linked callback
  const handleWalletLinked = (walletAddress) => {
    toast.success('Wallet linked successfully!', {
      description: `Address: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
      style: {
        backgroundColor: '#333',
        color: '#fff',
      },
    });
  };

  // Redirect if the session is not authenticated or if loading
  if (status === "loading" || !session?.user?.id) {
    return <p className="p-8 text-gray-100">Loading profile...</p>;
  }

  if (profileLoading) {
    return <p className="p-8 text-gray-100">Loading profile data...</p>;
  }

  return (
    <>
      <Head>
        <title>CryptoLens — Profile</title>
        <meta name="description" content="Manage your CryptoLens profile, link your wallet, and update preferences." />
        <link rel="canonical" href="https://cryptlens.casaislabs.com/profile" />
      </Head>
      <AppHeader title="CryptoLens" />
      <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black text-gray-100 flex items-center justify-center p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl w-full">
          {/* Profile Section */}
          <div className="bg-neutral-800 p-8 rounded-lg shadow-lg border border-neutral-700">
            <h1 className="text-3xl font-bold text-white mb-6">👤 User Profile</h1>
  
            <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
              {isEditing ? (
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 border border-neutral-700 rounded-lg bg-neutral-900 text-gray-100 focus:ring focus:ring-blue-500 focus:outline-none"
                />
              ) : (
                <p className="text-lg font-medium text-white">{formData.username}</p>
              )}
            </div>
  
            <Separator className="my-4" />
  
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Bio</label>
              {isEditing ? (
                <textarea
                  name="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="w-full px-4 py-2 border border-neutral-700 rounded-lg bg-neutral-900 text-gray-100 focus:ring focus:ring-blue-500 focus:outline-none resize-none"
                  rows={4}
                />
              ) : (
                <p className="text-gray-300">{formData.bio || "No bio available"}</p>
              )}
            </div>
  
            <Separator className="my-4" />
  
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Twitter</label>
              {isEditing ? (
                <input
                  type="text"
                  name="twitter"
                  value={formData.socialLinks.twitter}
                  onChange={handleChange}
                  placeholder="e.g., https://twitter.com/username, @username, or username"
                  className="w-full px-4 py-2 border border-neutral-700 rounded-lg bg-neutral-900 text-gray-100 focus:ring focus:ring-blue-500 focus:outline-none"
                />
              ) : validLinks.twitter ? (
                <a
                  href={normalizeSocialLink("twitter", formData.socialLinks.twitter)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline hover:text-blue-300"
                >
                  {formData.socialLinks.twitter}
                </a>
              ) : (
                <p className="text-gray-300">No valid Twitter link available</p>
              )}
            </div>
  
            <Separator className="my-4" />
  
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Telegram</label>
              {isEditing ? (
                <input
                  type="text"
                  name="telegram"
                  value={formData.socialLinks.telegram}
                  onChange={handleChange}
                  placeholder="e.g., https://t.me/username, @username, or username"
                  className="w-full px-4 py-2 border border-neutral-700 rounded-lg bg-neutral-900 text-gray-100 focus:ring focus:ring-blue-500 focus:outline-none"
                />
              ) : validLinks.telegram ? (
                <a
                  href={normalizeSocialLink("telegram", formData.socialLinks.telegram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline hover:text-blue-300"
                >
                  {formData.socialLinks.telegram}
                </a>
              ) : (
                <p className="text-gray-300">No valid Telegram link available</p>
              )}
            </div>
  
            <Separator className="my-4" />
  
            <div className="flex justify-end space-x-4">
              {isEditing && (
                <Button variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              )}
              <Button onClick={toggleEdit} disabled={loading}>
                {loading ? "Saving..." : isEditing ? "Save Changes" : "Edit Profile"}
              </Button>
            </div>
            </div>
          </div>
          
          {/* Wallet Section */}
          <div className="bg-neutral-800 p-8 rounded-lg shadow-lg border border-neutral-700">
            <h2 className="text-2xl font-bold text-white mb-6">🔗 Wallet Connection</h2>
            <WalletConnection 
              userId={session.user.id} 
              onWalletLinked={handleWalletLinked} 
            />
          </div>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const { getSession } = await import("next-auth/react");
  const session = await getSession(context);

  if (!session) {
    return {
      redirect: { destination: "/login", permanent: false },
    };
  }

  return { props: { session } };
}