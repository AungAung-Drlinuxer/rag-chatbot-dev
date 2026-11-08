--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id bigint NOT NULL,
    name character varying(128) NOT NULL,
    key_hash character varying(64) NOT NULL,
    key_prefix character varying(16) NOT NULL,
    scope character varying(32) NOT NULL,
    owner character varying(64) NOT NULL,
    active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: app_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_group_members (
    group_name character varying(64) NOT NULL,
    username character varying(64) NOT NULL
);


--
-- Name: app_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_groups (
    name character varying(64) NOT NULL,
    description character varying(255),
    role character varying(32) DEFAULT 'user'::character varying NOT NULL,
    permissions jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid NOT NULL,
    username character varying(64),
    question text,
    status character varying(16) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    decided_by character varying(64),
    decided_at timestamp with time zone,
    thread_id character varying(64)
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    action character varying(64) NOT NULL,
    username character varying(64),
    domain character varying(64),
    confidence double precision,
    decision character varying(16),
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: chat_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_attachments (
    id character varying(40) NOT NULL,
    session_id character varying(64),
    username character varying(64),
    filename text,
    mime character varying(128),
    size integer,
    data bytea,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    role character varying(16) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    meta text
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid NOT NULL,
    username character varying(64) NOT NULL,
    domain character varying(64),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    title character varying(200),
    is_pinned boolean DEFAULT false NOT NULL,
    connector_scope text
);


--
-- Name: checkpoint_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_blobs (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea
);


--
-- Name: checkpoint_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_migrations (
    v integer NOT NULL
);


--
-- Name: checkpoint_writes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_writes (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    task_id text NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text,
    blob bytea NOT NULL,
    task_path text DEFAULT ''::text NOT NULL
);


--
-- Name: checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoints (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: classifier_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classifier_domains (
    id integer NOT NULL,
    domain_key character varying(64) NOT NULL,
    display_name character varying(128) NOT NULL,
    description text,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    jira_project character varying(32),
    jira_assignee character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    icon character varying(32) DEFAULT 'BookOpen'::character varying,
    color character varying(32) DEFAULT 'blue'::character varying,
    custom_icon text
);


--
-- Name: classifier_domains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.classifier_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: classifier_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.classifier_domains_id_seq OWNED BY public.classifier_domains.id;


--
-- Name: department_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_members (
    department character varying(64) NOT NULL,
    member_type character varying(8) NOT NULL,
    member_name character varying(64) NOT NULL
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    name character varying(64) NOT NULL,
    description character varying(255),
    created_by character varying(64),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id bigint NOT NULL,
    message_id character varying(255),
    rating smallint,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.feedback_id_seq OWNED BY public.feedback.id;


--
-- Name: jira_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jira_tickets (
    id bigint NOT NULL,
    session_id uuid,
    jira_key character varying(64),
    domain character varying(64),
    status character varying(32),
    created_by character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subject character varying(200),
    description text,
    priority character varying(16),
    assignee character varying(64),
    due_date timestamp with time zone
);


--
-- Name: jira_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jira_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jira_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jira_tickets_id_seq OWNED BY public.jira_tickets.id;


--
-- Name: kb_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_meta (
    page_id character varying(128) NOT NULL,
    content_hash character varying(64) NOT NULL,
    domain character varying(64),
    title character varying(512),
    source_url text,
    last_synced timestamp with time zone DEFAULT now() NOT NULL,
    body text,
    updated_by character varying(64)
);


--
-- Name: langchain_pg_collection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.langchain_pg_collection (
    name character varying,
    cmetadata json,
    uuid uuid NOT NULL
);


--
-- Name: langchain_pg_embedding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.langchain_pg_embedding (
    collection_id uuid,
    embedding public.vector(768),
    document character varying,
    cmetadata json,
    custom_id character varying,
    uuid uuid NOT NULL,
    tsv tsvector
);


--
-- Name: local_user_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_user_credentials (
    username character varying(64) NOT NULL,
    password_hash character varying(255) NOT NULL,
    source character varying(8) DEFAULT 'local'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rbac_matrix; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_matrix (
    role character varying(32) NOT NULL,
    permissions jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by character varying(64)
);


--
-- Name: runtime_kv; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_kv (
    key character varying(128) NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: semantica_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.semantica_entities (
    id bigint NOT NULL,
    name text NOT NULL,
    label text,
    mentions integer DEFAULT 0 NOT NULL,
    page_ids text[] DEFAULT '{}'::text[] NOT NULL,
    source_urls text[] DEFAULT '{}'::text[] NOT NULL,
    method text DEFAULT 'pattern'::text NOT NULL
);


--
-- Name: semantica_entities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.semantica_entities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: semantica_entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.semantica_entities_id_seq OWNED BY public.semantica_entities.id;


--
-- Name: semantica_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.semantica_relations (
    id bigint NOT NULL,
    subject text NOT NULL,
    predicate text NOT NULL,
    object text NOT NULL,
    mentions integer DEFAULT 0 NOT NULL,
    page_ids text[] DEFAULT '{}'::text[] NOT NULL,
    source_urls text[] DEFAULT '{}'::text[] NOT NULL,
    method text DEFAULT 'pattern'::text NOT NULL
);


--
-- Name: semantica_relations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.semantica_relations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: semantica_relations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.semantica_relations_id_seq OWNED BY public.semantica_relations.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key character varying(64) NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ticket_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_attachments (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    filename character varying(255) NOT NULL,
    content_type character varying(128),
    data bytea NOT NULL,
    size_bytes bigint NOT NULL,
    created_by character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_attachments_id_seq OWNED BY public.ticket_attachments.id;


--
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_comments (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    author character varying(64),
    body text NOT NULL,
    kind character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_comments_id_seq OWNED BY public.ticket_comments.id;


--
-- Name: user_permission_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permission_overrides (
    username character varying(64) NOT NULL,
    permissions jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by character varying(64)
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    username character varying(64) NOT NULL,
    theme character varying(16) NOT NULL,
    density character varying(16) NOT NULL,
    chat_font_size smallint DEFAULT 14 NOT NULL,
    show_token_usage boolean DEFAULT true NOT NULL,
    show_rag_sources boolean DEFAULT true NOT NULL,
    stream_responses boolean DEFAULT true NOT NULL,
    markdown_rendering boolean DEFAULT true NOT NULL,
    auto_escalate_on_caution boolean DEFAULT false NOT NULL,
    history_retention_days smallint DEFAULT 30 NOT NULL,
    escalate_include_transcript boolean DEFAULT true NOT NULL,
    escalate_include_sources boolean DEFAULT true NOT NULL,
    escalate_open_new_tab boolean DEFAULT true NOT NULL,
    code_font character varying(32) DEFAULT 'JetBrains Mono'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    debug_mode boolean DEFAULT false,
    settings jsonb DEFAULT '{}'::jsonb,
    prefs jsonb
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username character varying(64) NOT NULL,
    email character varying(255),
    ldap_dn character varying(255),
    department character varying(128),
    status character varying(16) DEFAULT 'Active'::character varying NOT NULL,
    role_override character varying(32),
    disabled_at timestamp with time zone,
    last_login timestamp with time zone,
    last_seen timestamp with time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: classifier_domains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classifier_domains ALTER COLUMN id SET DEFAULT nextval('public.classifier_domains_id_seq'::regclass);


--
-- Name: feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback ALTER COLUMN id SET DEFAULT nextval('public.feedback_id_seq'::regclass);


--
-- Name: jira_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_tickets ALTER COLUMN id SET DEFAULT nextval('public.jira_tickets_id_seq'::regclass);


--
-- Name: semantica_entities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantica_entities ALTER COLUMN id SET DEFAULT nextval('public.semantica_entities_id_seq'::regclass);


--
-- Name: semantica_relations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantica_relations ALTER COLUMN id SET DEFAULT nextval('public.semantica_relations_id_seq'::regclass);


--
-- Name: ticket_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_attachments ALTER COLUMN id SET DEFAULT nextval('public.ticket_attachments_id_seq'::regclass);


--
-- Name: ticket_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments ALTER COLUMN id SET DEFAULT nextval('public.ticket_comments_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: app_group_members app_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_group_members
    ADD CONSTRAINT app_group_members_pkey PRIMARY KEY (group_name, username);


--
-- Name: app_groups app_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_groups
    ADD CONSTRAINT app_groups_pkey PRIMARY KEY (name);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: chat_attachments chat_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_blobs checkpoint_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);


--
-- Name: checkpoint_migrations checkpoint_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);


--
-- Name: checkpoint_writes checkpoint_writes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);


--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);


--
-- Name: classifier_domains classifier_domains_domain_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classifier_domains
    ADD CONSTRAINT classifier_domains_domain_key_key UNIQUE (domain_key);


--
-- Name: classifier_domains classifier_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classifier_domains
    ADD CONSTRAINT classifier_domains_pkey PRIMARY KEY (id);


--
-- Name: department_members department_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members
    ADD CONSTRAINT department_members_pkey PRIMARY KEY (department, member_type, member_name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (name);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: jira_tickets jira_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jira_tickets
    ADD CONSTRAINT jira_tickets_pkey PRIMARY KEY (id);


--
-- Name: kb_meta kb_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_meta
    ADD CONSTRAINT kb_meta_pkey PRIMARY KEY (page_id);


--
-- Name: langchain_pg_collection langchain_pg_collection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.langchain_pg_collection
    ADD CONSTRAINT langchain_pg_collection_pkey PRIMARY KEY (uuid);


--
-- Name: langchain_pg_embedding langchain_pg_embedding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.langchain_pg_embedding
    ADD CONSTRAINT langchain_pg_embedding_pkey PRIMARY KEY (uuid);


--
-- Name: local_user_credentials local_user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_user_credentials
    ADD CONSTRAINT local_user_credentials_pkey PRIMARY KEY (username);


--
-- Name: rbac_matrix rbac_matrix_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_matrix
    ADD CONSTRAINT rbac_matrix_pkey PRIMARY KEY (role);


--
-- Name: runtime_kv runtime_kv_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_kv
    ADD CONSTRAINT runtime_kv_pkey PRIMARY KEY (key);


--
-- Name: semantica_entities semantica_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantica_entities
    ADD CONSTRAINT semantica_entities_pkey PRIMARY KEY (id);


--
-- Name: semantica_relations semantica_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantica_relations
    ADD CONSTRAINT semantica_relations_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: ticket_attachments ticket_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_attachments
    ADD CONSTRAINT ticket_attachments_pkey PRIMARY KEY (id);


--
-- Name: ticket_comments ticket_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_pkey PRIMARY KEY (id);


--
-- Name: user_permission_overrides user_permission_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_pkey PRIMARY KEY (username);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: checkpoint_blobs_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoint_blobs_thread_id_idx ON public.checkpoint_blobs USING btree (thread_id);


--
-- Name: checkpoint_writes_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoint_writes_thread_id_idx ON public.checkpoint_writes USING btree (thread_id);


--
-- Name: checkpoints_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoints_thread_id_idx ON public.checkpoints USING btree (thread_id);


--
-- Name: ix_api_keys_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_api_keys_key_hash ON public.api_keys USING btree (key_hash);


--
-- Name: ix_ticket_attachments_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ticket_attachments_ticket ON public.ticket_attachments USING btree (ticket_id);


--
-- Name: ix_ticket_attachments_ticket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ticket_attachments_ticket_id ON public.ticket_attachments USING btree (ticket_id);


--
-- Name: ix_ticket_comments_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ticket_comments_ticket ON public.ticket_comments USING btree (ticket_id);


--
-- Name: ix_ticket_comments_ticket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ticket_comments_ticket_id ON public.ticket_comments USING btree (ticket_id);


--
-- Name: langchain_pg_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX langchain_pg_embedding_hnsw_idx ON public.langchain_pg_embedding USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: langchain_pg_embedding_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX langchain_pg_embedding_tsv_idx ON public.langchain_pg_embedding USING gin (tsv);


--
-- Name: semantica_entities_method_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX semantica_entities_method_idx ON public.semantica_entities USING btree (method);


--
-- Name: semantica_entities_name_label_method_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX semantica_entities_name_label_method_key ON public.semantica_entities USING btree (name, label, method);


--
-- Name: semantica_relations_method_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX semantica_relations_method_idx ON public.semantica_relations USING btree (method);


--
-- Name: semantica_relations_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX semantica_relations_object_idx ON public.semantica_relations USING btree (object);


--
-- Name: semantica_relations_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX semantica_relations_subject_idx ON public.semantica_relations USING btree (subject);


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id);


--
-- Name: langchain_pg_embedding langchain_pg_embedding_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.langchain_pg_embedding
    ADD CONSTRAINT langchain_pg_embedding_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.langchain_pg_collection(uuid) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

